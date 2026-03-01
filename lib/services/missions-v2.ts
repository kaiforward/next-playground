/**
 * Operational missions service — patrol, survey, bounty, salvage, recon.
 * Separate from trade missions (lib/services/missions.ts).
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import { OP_MISSION_CONSTANTS } from "@/lib/constants/missions";
import { COMBAT_CONSTANTS, getEnemyTier } from "@/lib/constants/combat";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { aggregateDangerLevel, DANGER_CONSTANTS } from "@/lib/engine/danger";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import { derivePlayerCombatStats, deriveEnemyCombatStats } from "@/lib/engine/combat";
import { toGovernmentType, toTraitId, toQualityTier, toOpMissionStatus, toBattleStatus, toEnemyTier, toMissionType, isStatGateMessage, toStatRequirements } from "@/lib/types/guards";
import type { MissionInfo, BattleInfo, BattleRoundResult } from "@/lib/types/game";
import type {
  SystemAllMissionsData,
  AcceptOpMissionResult,
  StartOpMissionResult,
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
  const statRequirements = toStatRequirements(row.statRequirements);

  return {
    id: row.id,
    type: toMissionType(row.type),
    systemId: row.systemId,
    systemName: row.system.name,
    targetSystemId: row.targetSystemId,
    targetSystemName: row.targetSystem.name,
    reward: row.reward,
    deadlineTick: row.deadlineTick,
    ticksRemaining: Math.max(0, row.deadlineTick - tick),
    durationTicks: row.durationTicks,
    enemyTier: row.enemyTier ? toEnemyTier(row.enemyTier) : null,
    statRequirements,
    status: toOpMissionStatus(row.status),
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
    status: toBattleStatus(row.status),
    playerStrength: row.playerStrength,
    playerMorale: row.playerMorale,
    playerMaxStrength,
    enemyStrength: row.enemyStrength,
    enemyMorale: row.enemyMorale,
    enemyMaxStrength,
    enemyType: row.enemyType,
    enemyTier: toEnemyTier(row.enemyTier),
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

  // Pre-tx cap check (fast path)
  const activeCount = await prisma.mission.count({
    where: { playerId, status: { in: ["accepted", "in_progress"] } },
  });
  if (activeCount >= OP_MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER) {
    return { ok: false, error: `Cannot have more than ${OP_MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER} active operational missions.`, status: 400 };
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

    // TOCTOU re-check cap inside transaction
    const freshCount = await tx.mission.count({
      where: { playerId, status: { in: ["accepted", "in_progress"] } },
    });
    if (freshCount >= OP_MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER) {
      throw new Error("CAP_EXCEEDED");
    }

    const updated = await tx.mission.update({
      where: { id: missionId },
      data: {
        status: "accepted",
        playerId,
        acceptedAtTick: tick,
      },
      include: missionInclude,
    });

    return { mission: updated };
  }).catch((error) => {
    if (error instanceof Error && error.message === "MISSION_UNAVAILABLE") {
      return "UNAVAILABLE" as const;
    }
    if (error instanceof Error && error.message === "CAP_EXCEEDED") {
      return "CAP_EXCEEDED" as const;
    }
    throw error;
  });

  if (txResult === "UNAVAILABLE") {
    return { ok: false, error: "Mission is no longer available.", status: 409 };
  }

  if (txResult === "CAP_EXCEEDED") {
    return { ok: false, error: `Cannot have more than ${OP_MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER} active operational missions.`, status: 400 };
  }

  return {
    ok: true,
    data: {
      mission: serializeMission(txResult.mission, tick),
    },
  };
}

// ── Start mission ────────────────────────────────────────────────

type StartResult =
  | { ok: true; data: StartOpMissionResult }
  | { ok: false; error: string; status: number };

export async function startMission(
  playerId: string,
  missionId: string,
  shipId: string,
): Promise<StartResult> {
  // Pre-validate mission
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      ...missionInclude,
      targetSystem: {
        select: {
          name: true,
          region: { select: { governmentType: true } },
          traits: { select: { traitId: true, quality: true } },
        },
      },
    },
  });

  if (!mission) {
    return { ok: false, error: "Mission not found.", status: 404 };
  }

  if (mission.status !== "accepted") {
    return { ok: false, error: "Mission must be accepted before starting.", status: 400 };
  }

  if (mission.playerId !== playerId) {
    return { ok: false, error: "This mission does not belong to you.", status: 403 };
  }

  const tick = await getCurrentTick();

  // Transaction: all ship validation + mission update inside for TOCTOU safety
  const txResult = await prisma.$transaction(async (tx) => {
    const fresh = await tx.mission.findUnique({
      where: { id: missionId },
    });

    if (!fresh || fresh.status !== "accepted" || fresh.playerId !== playerId) {
      throw new Error("MISSION_UNAVAILABLE");
    }

    // Validate ship inside transaction
    const freshShip = await tx.ship.findUnique({
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
        hullCurrent: true,
        shieldMax: true,
        shieldCurrent: true,
        stealth: true,
        evasion: true,
        convoyMember: { select: { convoyId: true } },
      },
    });

    if (!freshShip || freshShip.playerId !== playerId) {
      throw new Error("SHIP_NOT_FOUND");
    }
    if (freshShip.status !== "docked") {
      throw new Error("SHIP_NOT_DOCKED");
    }
    if (freshShip.disabled) {
      throw new Error("SHIP_DISABLED");
    }
    if (freshShip.systemId !== mission.targetSystemId) {
      throw new Error("SHIP_WRONG_SYSTEM");
    }
    if (freshShip.convoyMember) {
      throw new Error("SHIP_IN_CONVOY");
    }

    // Check stat gates
    const statReqs: Record<string, number> = JSON.parse(mission.statRequirements);
    const shipStatMap: Record<string, number> = {
      firepower: freshShip.firepower,
      sensors: freshShip.sensors,
      hullMax: freshShip.hullMax,
      stealth: freshShip.stealth,
    };

    for (const [stat, required] of Object.entries(statReqs)) {
      const actual = shipStatMap[stat] ?? 0;
      if (actual < required) {
        throw new Error(`STAT_GATE:${stat} ${actual} < ${required}`);
      }
    }

    // Check if ship is already committed to another mission
    const existingCommitment = await tx.mission.findFirst({
      where: {
        shipId,
        status: { in: ["accepted", "in_progress"] },
      },
    });
    if (existingCommitment) {
      throw new Error("SHIP_COMMITTED");
    }

    // Check if ship is in battle
    const existingBattle = await tx.battle.findFirst({
      where: {
        shipId,
        status: "active",
      },
    });
    if (existingBattle) {
      throw new Error("SHIP_IN_BATTLE");
    }

    const updated = await tx.mission.update({
      where: { id: missionId },
      data: {
        status: "in_progress",
        shipId,
        startedAtTick: tick,
      },
      include: missionInclude,
    });

    // For bounty missions, create a battle
    if (mission.type === "bounty") {
      // Compute danger at system for enemy scaling
      const navModifiers = await tx.eventModifier.findMany({
        where: {
          domain: "navigation",
          targetType: "system",
          targetId: mission.targetSystemId,
        },
        select: {
          targetId: true,
          domain: true,
          type: true,
          targetType: true,
          goodId: true,
          parameter: true,
          value: true,
        },
      });

      const govType = mission.targetSystem?.region?.governmentType
        ? toGovernmentType(mission.targetSystem.region.governmentType)
        : undefined;
      const govDef = govType ? GOVERNMENT_TYPES[govType] : undefined;
      const govBaseline = govDef?.dangerBaseline ?? 0;
      const destTraits = (mission.targetSystem?.traits ?? []).map((t) => ({
        traitId: toTraitId(t.traitId),
        quality: toQualityTier(t.quality),
      }));
      const traitDanger = computeTraitDanger(destTraits);
      const danger = Math.max(0, Math.min(
        aggregateDangerLevel(navModifiers) + govBaseline + traitDanger,
        DANGER_CONSTANTS.MAX_DANGER,
      ));

      const playerStats = derivePlayerCombatStats(freshShip);
      const enemyTier = mission.enemyTier
        ? toEnemyTier(mission.enemyTier)
        : getEnemyTier(danger);
      const enemyStats = deriveEnemyCombatStats(enemyTier, danger);

      await tx.battle.create({
        data: {
          type: "pirate_encounter",
          systemId: mission.targetSystemId,
          missionId: mission.id,
          shipId,
          status: "active",
          playerStrength: playerStats.strength,
          playerMorale: playerStats.morale,
          dangerLevel: danger,
          initialPlayerStrength: playerStats.strength,
          enemyStrength: enemyStats.strength,
          enemyMorale: enemyStats.morale,
          enemyType: "pirates",
          enemyTier: enemyTier,
          roundInterval: COMBAT_CONSTANTS.ROUND_INTERVAL,
          nextRoundTick: tick + COMBAT_CONSTANTS.ROUND_INTERVAL,
          createdAtTick: tick,
        },
      });
    }

    return { mission: updated };
  }).catch((error) => {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg === "MISSION_UNAVAILABLE") return "MISSION_UNAVAILABLE" as const;
      if (msg === "SHIP_NOT_FOUND") return "SHIP_NOT_FOUND" as const;
      if (msg === "SHIP_NOT_DOCKED") return "SHIP_NOT_DOCKED" as const;
      if (msg === "SHIP_DISABLED") return "SHIP_DISABLED" as const;
      if (msg === "SHIP_WRONG_SYSTEM") return "SHIP_WRONG_SYSTEM" as const;
      if (msg === "SHIP_IN_CONVOY") return "SHIP_IN_CONVOY" as const;
      if (msg === "SHIP_COMMITTED") return "SHIP_COMMITTED" as const;
      if (msg === "SHIP_IN_BATTLE") return "SHIP_IN_BATTLE" as const;
      if (isStatGateMessage(msg)) return msg;
    }
    throw error;
  });

  if (typeof txResult === "string") {
    const errorMap: Record<string, { error: string; status: number }> = {
      MISSION_UNAVAILABLE: { error: "Mission is no longer available.", status: 409 },
      SHIP_NOT_FOUND: { error: "Ship not found or does not belong to you.", status: 404 },
      SHIP_NOT_DOCKED: { error: "Ship must be docked to start a mission.", status: 400 },
      SHIP_DISABLED: { error: "Ship is disabled.", status: 400 },
      SHIP_WRONG_SYSTEM: { error: "Ship must be at the mission's target system.", status: 400 },
      SHIP_IN_CONVOY: { error: "Ship cannot start a mission while in a convoy.", status: 400 },
      SHIP_COMMITTED: { error: "Ship is already committed to another mission.", status: 400 },
      SHIP_IN_BATTLE: { error: "Ship is currently in battle.", status: 400 },
    };
    if (txResult.startsWith("STAT_GATE:")) {
      return { ok: false, error: `Ship does not meet requirement: ${txResult.slice("STAT_GATE:".length)}.`, status: 400 };
    }
    const mapped = errorMap[txResult];
    if (mapped) return { ok: false, ...mapped };
    throw new Error(`Unexpected sentinel: ${txResult}`);
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

  const txResult = await prisma.$transaction(async (tx) => {
    const fresh = await tx.mission.findUnique({ where: { id: missionId } });
    if (!fresh || fresh.playerId !== playerId) {
      throw new Error("NOT_YOURS");
    }

    // Battle check inside transaction for TOCTOU safety
    if (fresh.status === "in_progress") {
      const battle = await tx.battle.findFirst({
        where: { missionId, status: "active" },
      });
      if (battle) {
        throw new Error("IN_BATTLE");
      }
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

    return "OK" as const;
  }).catch((error) => {
    if (error instanceof Error && error.message === "NOT_YOURS") {
      return "NOT_YOURS" as const;
    }
    if (error instanceof Error && error.message === "IN_BATTLE") {
      return "IN_BATTLE" as const;
    }
    throw error;
  });

  if (txResult === "NOT_YOURS") {
    return { ok: false, error: "This mission does not belong to you.", status: 403 };
  }

  if (txResult === "IN_BATTLE") {
    return { ok: false, error: "Cannot abandon mission while in battle.", status: 400 };
  }

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
      status: "active",
    },
    include: battleInclude,
    orderBy: { createdAtTick: "desc" },
  });

  return battles.map(serializeBattle);
}

export async function getBattleDetail(
  battleId: string,
  playerId: string,
): Promise<BattleInfo> {
  const battle = await prisma.battle.findUnique({
    where: { id: battleId },
    include: {
      system: { select: { name: true } },
      ship: { select: { name: true, hullMax: true, shieldMax: true, playerId: true } },
    },
  });

  if (!battle) {
    throw new ServiceError("Battle not found.", 404);
  }

  if (battle.ship?.playerId !== playerId) {
    throw new ServiceError("Battle not found.", 404);
  }

  return serializeBattle(battle);
}
