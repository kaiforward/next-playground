/**
 * Operational missions service — patrol, survey, bounty.
 * Separate from trade missions (lib/services/missions.ts).
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import { MISSION_TYPE_DEFS, type StatGateKey } from "@/lib/constants/missions";
import type { MissionInfo, BattleInfo, BattleRoundResult, OpMissionStatus, BattleStatus } from "@/lib/types/game";
import type {
  SystemAllMissionsData,
  AcceptOpMissionResult,
} from "@/lib/types/api";
import * as tradeMissionService from "./missions";

// ── Helpers ──────────────────────────────────────────────────────

async function getCurrentTick(): Promise<number> {
  const world = await prisma.gameWorld.findFirst();
  return world?.currentTick ?? 0;
}

type MissionRow = {
  id: string;
  type: string;
  systemId: string;
  targetSystemId: string;
  reward: number;
  deadlineTick: number;
  durationTicks: number | null;
  enemyTier: string | null;
  statRequirements: string;
  status: string;
  playerId: string | null;
  shipId: string | null;
  acceptedAtTick: number | null;
  startedAtTick: number | null;
  completedAtTick: number | null;
  createdAtTick: number;
  system: { name: string };
  targetSystem: { name: string };
};

function serializeMission(row: MissionRow, tick: number): MissionInfo {
  return {
    id: row.id,
    type: row.type,
    systemId: row.systemId,
    systemName: row.system.name,
    targetSystemId: row.targetSystemId,
    targetSystemName: row.targetSystem.name,
    reward: row.reward,
    deadlineTick: row.deadlineTick,
    ticksRemaining: Math.max(0, row.deadlineTick - tick),
    durationTicks: row.durationTicks,
    enemyTier: row.enemyTier,
    statRequirements: JSON.parse(row.statRequirements) as Record<string, number>,
    status: row.status as OpMissionStatus,
    playerId: row.playerId,
    shipId: row.shipId,
    acceptedAtTick: row.acceptedAtTick,
    startedAtTick: row.startedAtTick,
    completedAtTick: row.completedAtTick,
  };
}

const missionInclude = {
  system: { select: { name: true } },
  targetSystem: { select: { name: true } },
} as const;

type BattleRow = {
  id: string;
  type: string;
  systemId: string;
  missionId: string | null;
  shipId: string | null;
  status: string;
  playerStrength: number;
  playerMorale: number;
  enemyStrength: number;
  enemyMorale: number;
  enemyType: string;
  enemyTier: string;
  roundsCompleted: number;
  roundHistory: string;
  createdAtTick: number;
  resolvedAtTick: number | null;
  system: { name: string };
  ship: { name: string; hullMax: number; shieldMax: number } | null;
};

function serializeBattle(row: BattleRow): BattleInfo {
  const roundHistory: BattleRoundResult[] = JSON.parse(row.roundHistory);
  // Derive max strength from first round or ship stats
  const playerMaxStrength = row.ship
    ? row.ship.hullMax + row.ship.shieldMax
    : (roundHistory.length > 0
        ? Math.max(row.playerStrength, roundHistory[0].playerStrengthAfter + roundHistory[0].enemyDamageDealt)
        : row.playerStrength);

  // Derive enemy max from first round data
  const enemyMaxStrength = roundHistory.length > 0
    ? Math.max(row.enemyStrength, roundHistory[0].enemyStrengthAfter + roundHistory[0].playerDamageDealt)
    : row.enemyStrength;

  return {
    id: row.id,
    type: row.type,
    systemId: row.systemId,
    systemName: row.system.name,
    missionId: row.missionId,
    shipId: row.shipId,
    shipName: row.ship?.name ?? null,
    status: row.status as BattleStatus,
    playerStrength: row.playerStrength,
    playerMorale: row.playerMorale,
    playerMaxStrength,
    enemyStrength: row.enemyStrength,
    enemyMorale: row.enemyMorale,
    enemyMaxStrength,
    enemyType: row.enemyType,
    enemyTier: row.enemyTier,
    roundsCompleted: row.roundsCompleted,
    roundHistory,
    createdAtTick: row.createdAtTick,
    resolvedAtTick: row.resolvedAtTick,
  };
}

const battleInclude = {
  system: { select: { name: true } },
  ship: { select: { name: true, hullMax: true, shieldMax: true } },
} as const;

// ── Read functions ──────────────────────────────────────────────

/**
 * Get all missions at a system — both trade and operational.
 */
export async function getSystemAllMissions(
  playerId: string,
  systemId: string,
): Promise<SystemAllMissionsData> {
  const tick = await getCurrentTick();

  const [tradeMissions, availableOp, activeOp] = await Promise.all([
    tradeMissionService.getSystemMissions(playerId, systemId),
    prisma.mission.findMany({
      where: {
        systemId,
        status: "available",
        deadlineTick: { gt: tick },
      },
      include: missionInclude,
    }),
    prisma.mission.findMany({
      where: {
        playerId,
        status: { in: ["accepted", "in_progress"] },
      },
      include: missionInclude,
    }),
  ]);

  return {
    tradeMissions,
    opMissions: {
      available: availableOp.map((m) => serializeMission(m, tick)),
      active: activeOp.map((m) => serializeMission(m, tick)),
    },
  };
}

/**
 * Get player's active operational missions.
 */
export async function getPlayerOpMissions(
  playerId: string,
): Promise<MissionInfo[]> {
  const tick = await getCurrentTick();

  const missions = await prisma.mission.findMany({
    where: {
      playerId,
      status: { in: ["accepted", "in_progress"] },
    },
    include: missionInclude,
  });

  return missions.map((m) => serializeMission(m, tick));
}

// ── Accept mission ──────────────────────────────────────────────

type AcceptResult =
  | { ok: true; data: AcceptOpMissionResult }
  | { ok: false; error: string; status: number };

export async function acceptMission(
  playerId: string,
  missionId: string,
  shipId: string,
): Promise<AcceptResult> {
  // Pre-validate
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: missionInclude,
  });

  if (!mission) {
    return { ok: false, error: "Mission not found.", status: 404 };
  }

  if (mission.status !== "available") {
    return { ok: false, error: "Mission is no longer available.", status: 409 };
  }

  // Validate ship
  const ship = await prisma.ship.findUnique({
    where: { id: shipId },
    select: {
      id: true,
      playerId: true,
      status: true,
      systemId: true,
      disabled: true,
      firepower: true,
      sensors: true,
      hullMax: true,
      stealth: true,
    },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
  }

  if (ship.status !== "docked") {
    return { ok: false, error: "Ship must be docked to accept missions.", status: 400 };
  }

  if (ship.disabled) {
    return { ok: false, error: "Ship is disabled.", status: 400 };
  }

  if (ship.systemId !== mission.systemId) {
    return { ok: false, error: "Ship must be at the mission system.", status: 400 };
  }

  // Check stat gates
  const statReqs = JSON.parse(mission.statRequirements) as Record<string, number>;
  const shipStats: Record<StatGateKey, number> = {
    firepower: ship.firepower,
    sensors: ship.sensors,
    hullMax: ship.hullMax,
    stealth: ship.stealth,
  };

  for (const [stat, required] of Object.entries(statReqs)) {
    const actual = shipStats[stat as StatGateKey] ?? 0;
    if (actual < required) {
      return {
        ok: false,
        error: `Ship does not meet requirement: ${stat} ${actual} < ${required}.`,
        status: 400,
      };
    }
  }

  // Check if ship is already committed to another mission
  const existingCommitment = await prisma.mission.findFirst({
    where: {
      shipId,
      status: { in: ["accepted", "in_progress"] },
    },
  });

  if (existingCommitment) {
    return { ok: false, error: "Ship is already committed to another mission.", status: 400 };
  }

  // Check if ship is in battle
  const existingBattle = await prisma.battle.findFirst({
    where: {
      shipId,
      status: "active",
    },
  });

  if (existingBattle) {
    return { ok: false, error: "Ship is currently in battle.", status: 400 };
  }

  const tick = await getCurrentTick();

  // Transaction: TOCTOU guard
  const txResult = await prisma.$transaction(async (tx) => {
    const fresh = await tx.mission.findUnique({
      where: { id: missionId },
    });

    if (!fresh || fresh.status !== "available") {
      throw new Error("MISSION_UNAVAILABLE");
    }

    const updated = await tx.mission.update({
      where: { id: missionId },
      data: {
        status: "accepted",
        playerId,
        shipId,
        acceptedAtTick: tick,
      },
      include: missionInclude,
    });

    return { mission: updated };
  }).catch((error) => {
    if (error instanceof Error && error.message === "MISSION_UNAVAILABLE") {
      return "UNAVAILABLE" as const;
    }
    throw error;
  });

  if (txResult === "UNAVAILABLE") {
    return { ok: false, error: "Mission is no longer available.", status: 409 };
  }

  return {
    ok: true,
    data: {
      mission: serializeMission(txResult.mission, tick),
    },
  };
}

// ── Abandon mission ─────────────────────────────────────────────

type AbandonResult =
  | { ok: true; data: { missionId: string } }
  | { ok: false; error: string; status: number };

export async function abandonMission(
  playerId: string,
  missionId: string,
): Promise<AbandonResult> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
  });

  if (!mission) {
    return { ok: false, error: "Mission not found.", status: 404 };
  }

  if (mission.playerId !== playerId) {
    return { ok: false, error: "This mission does not belong to you.", status: 403 };
  }

  if (mission.status !== "accepted" && mission.status !== "in_progress") {
    return { ok: false, error: "Cannot abandon a mission that is not active.", status: 400 };
  }

  // If mission is in battle, can't abandon
  if (mission.status === "in_progress") {
    const battle = await prisma.battle.findFirst({
      where: { missionId, status: "active" },
    });
    if (battle) {
      return { ok: false, error: "Cannot abandon mission while in battle.", status: 400 };
    }
  }

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.mission.findUnique({ where: { id: missionId } });
    if (!fresh || fresh.playerId !== playerId) {
      throw new Error("MISSION_NOT_YOURS");
    }

    await tx.mission.update({
      where: { id: missionId },
      data: {
        status: "available",
        playerId: null,
        shipId: null,
        acceptedAtTick: null,
        startedAtTick: null,
      },
    });
  }).catch((error) => {
    if (error instanceof Error && error.message === "MISSION_NOT_YOURS") {
      return;
    }
    throw error;
  });

  return { ok: true, data: { missionId } };
}

// ── Battle reads ────────────────────────────────────────────────

export async function getActiveBattles(
  playerId: string,
): Promise<BattleInfo[]> {
  // Get player's ship IDs
  const ships = await prisma.ship.findMany({
    where: { playerId },
    select: { id: true },
  });
  const shipIds = ships.map((s) => s.id);

  if (shipIds.length === 0) return [];

  const battles = await prisma.battle.findMany({
    where: {
      shipId: { in: shipIds },
    },
    include: battleInclude,
    orderBy: { createdAtTick: "desc" },
  });

  return battles.map(serializeBattle);
}

export async function getBattleDetail(
  battleId: string,
): Promise<BattleInfo> {
  const battle = await prisma.battle.findUnique({
    where: { id: battleId },
    include: battleInclude,
  });

  if (!battle) {
    throw new ServiceError("Battle not found.", 404);
  }

  return serializeBattle(battle);
}
