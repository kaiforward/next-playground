import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  PlayerEventMap,
} from "../types";
import { addPlayerNotification, groupModifiersByTarget } from "../helpers";
import {
  generateOpMissionCandidates,
  selectEventOpMissionCandidates,
  type EventMissionContext,
  type SystemSnapshot,
} from "@/lib/engine/mission-gen";
import { EVENT_OP_MISSIONS } from "@/lib/constants/events";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import { computeSystemDanger } from "@/lib/engine/danger";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { OP_MISSION_CAP_PER_SYSTEM } from "@/lib/constants/missions";
import { PrismaOpMissionsWorld } from "@/lib/tick/adapters/prisma/op-missions";
import type {
  MissionCreate,
  OpMissionsWorld,
} from "@/lib/tick/world/op-missions-world";

export interface OpMissionsProcessorParams {
  rng: () => number;
}

/**
 * Pure processor body. Depends only on `OpMissionsWorld` + an injected RNG.
 * Owns: expiry, timed completion, failure, region round-robin candidate
 * generation. No live sim counterpart yet.
 */
export async function runOpMissionsProcessor(
  world: OpMissionsWorld,
  ctx: TickContext,
  params: OpMissionsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng } = params;

  // 1. Expire unclaimed missions ──────────────────────────────────
  const expiredCount = await world.expireUnclaimedMissions(ctx.tick);

  const playerEvents = new Map<string, Partial<PlayerEventMap>>();

  // 2. Complete timed missions ────────────────────────────────────
  const completable = await world.getCompletableTimedMissions(ctx.tick);

  if (completable.length > 0) {
    await world.completeMissions(
      completable.map((m) => m.id),
      ctx.tick,
    );

    const rewardsByPlayer = new Map<string, number>();
    for (const m of completable) {
      if (m.playerId) {
        rewardsByPlayer.set(
          m.playerId,
          (rewardsByPlayer.get(m.playerId) ?? 0) + m.reward,
        );
      }
    }
    await world.creditPlayers(rewardsByPlayer);

    for (const m of completable) {
      if (!m.playerId) continue;
      const typeLabel = m.type.charAt(0).toUpperCase() + m.type.slice(1);
      addPlayerNotification(playerEvents, m.playerId, {
        message: `${typeLabel} mission completed at ${m.targetSystemName} — earned ${m.reward} CR`,
        type: "mission_completed",
        refs: {
          system: { id: m.targetSystemId, label: m.targetSystemName },
          ...(m.shipId && m.shipName
            ? { ship: { id: m.shipId, label: m.shipName } }
            : {}),
        },
      });
    }
  }

  // 3. Fail accepted missions past deadline ───────────────────────
  const failed = await world.getFailedAcceptedMissions(ctx.tick);

  if (failed.length > 0) {
    await world.failMissions(failed.map((m) => m.id));

    for (const m of failed) {
      if (!m.playerId) continue;
      const typeLabel = m.type.charAt(0).toUpperCase() + m.type.slice(1);
      addPlayerNotification(playerEvents, m.playerId, {
        message: `${typeLabel} mission expired — ${m.targetSystemName}`,
        type: "mission_expired",
        refs: {
          system: { id: m.targetSystemId, label: m.targetSystemName },
          ...(m.shipId && m.shipName
            ? { ship: { id: m.shipId, label: m.shipName } }
            : {}),
        },
      });
    }
  }

  // 4. Region round-robin candidate generation ────────────────────
  const regions = await world.getRegions();
  if (regions.length === 0) {
    await world.persistNotifications(playerEvents, ctx.tick);
    return {
      globalEvents: {
        opMissionsUpdated: [{ generated: 0, expired: expiredCount }],
      },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  }

  const regionIndex = ctx.tick % regions.length;
  const targetRegion = regions[regionIndex];

  const systems = await world.getSystemsInRegion(targetRegion.id);
  const systemIds = systems.map((s) => s.id);

  const navModifiers = await world.getNavModifiersForSystems(systemIds);
  const modsBySystem = groupModifiersByTarget(navModifiers);

  // Danger baseline sources per-system from each system's owning faction
  // (see `SystemTraitView.governmentType`). Border regions can hold systems
  // with different governments, so this can't fold up to a region-wide baseline.
  const dangerLevels = new Map<string, number>();
  for (const system of systems) {
    const govDef = GOVERNMENT_TYPES[system.governmentType];
    const govBaseline = govDef?.dangerBaseline ?? 0;
    const traitDanger = computeTraitDanger(system.traits);
    const systemMods = modsBySystem.get(system.id) ?? [];
    dangerLevels.set(
      system.id,
      computeSystemDanger(systemMods, govBaseline, traitDanger, system.bodyDanger),
    );
  }

  const systemSnapshots: SystemSnapshot[] = systems.map((s) => ({
    id: s.id,
    name: s.name,
    traits: s.traits,
  }));

  const candidates = generateOpMissionCandidates(
    systemSnapshots,
    dangerLevels,
    ctx.tick,
    rng,
  );

  const activeEvents = await world.getActiveEventsForSystems(systemIds);
  const eventContexts: EventMissionContext[] = activeEvents.map((e) => ({
    eventId: e.id,
    eventType: e.type,
    systemId: e.systemId,
    severity: e.severity,
  }));

  const eventCandidates = selectEventOpMissionCandidates(
    eventContexts,
    EVENT_OP_MISSIONS,
    dangerLevels,
    ctx.tick,
    rng,
  );

  for (const c of eventCandidates) candidates.push(c);

  // 5. Per-system cap + insert ────────────────────────────────────
  let created = 0;
  if (candidates.length > 0) {
    const countBySystem = await world.getMissionCountsBySystem(systemIds);
    const toCreate: MissionCreate[] = [];
    const pendingBySystem = new Map<string, number>();

    for (const c of candidates) {
      const currentCount = countBySystem.get(c.systemId) ?? 0;
      const pendingCount = pendingBySystem.get(c.systemId) ?? 0;
      if (currentCount + pendingCount >= OP_MISSION_CAP_PER_SYSTEM) continue;

      pendingBySystem.set(c.systemId, pendingCount + 1);
      toCreate.push({
        type: c.type,
        systemId: c.systemId,
        targetSystemId: c.targetSystemId,
        reward: c.reward,
        deadlineTick: c.deadlineTick,
        durationTicks: c.durationTicks,
        enemyTier: c.enemyTier,
        statRequirements: JSON.stringify(c.statRequirements),
        createdAtTick: ctx.tick,
        eventId: c.eventId ?? null,
      });
    }

    await world.createMissions(toCreate);
    created = toCreate.length;
  }

  console.log(
    `[missions] Region ${regionIndex + 1}/${regions.length} "${targetRegion.name}" — expired ${expiredCount}, completed ${completable.length}, generated ${created} mission(s)`,
  );

  await world.persistNotifications(playerEvents, ctx.tick);

  return {
    globalEvents: {
      opMissionsUpdated: [{ generated: created, expired: expiredCount }],
    },
    playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
  };
}

// ── Live-game wiring ──────────────────────────────────────────────

export const missionsProcessor: TickProcessor = {
  name: "missions",
  // Runs every tick; round-robin region selection happens inside the body.
  frequency: 1,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaOpMissionsWorld(ctx.tx);
    return runOpMissionsProcessor(world, ctx, { rng: Math.random });
  },
};
