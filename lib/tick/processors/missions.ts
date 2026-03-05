import type {
  TickProcessor,
  TickProcessorResult,
  PlayerEventMap,
} from "../types";
import { persistPlayerNotifications, addPlayerNotification, groupModifiersByTarget } from "../helpers";
import {
  generateOpMissionCandidates,
  selectEventOpMissionCandidates,
  type SystemSnapshot,
  type EventMissionContext,
} from "@/lib/engine/mission-gen";
import { EVENT_OP_MISSIONS } from "@/lib/constants/events";
import { toEventTypeId } from "@/lib/types/guards";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import { computeSystemDanger } from "@/lib/engine/danger";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { OP_MISSION_CAP_PER_SYSTEM } from "@/lib/constants/missions";
import { toGovernmentType, toTraitId, toQualityTier } from "@/lib/types/guards";

export const missionsProcessor: TickProcessor = {
  name: "missions",
  // Runs every tick; round-robin region selection for candidate generation
  frequency: 1,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    // ── Global housekeeping (cheap indexed queries, not region-scoped) ──

    // 1. Expire unclaimed missions past deadline
    const expired = await ctx.tx.mission.deleteMany({
      where: {
        deadlineTick: { lte: ctx.tick },
        status: "available",
      },
    });

    // 2. Complete timed missions (patrol/survey/salvage/recon) where commitment is done
    const completedMissions = await ctx.tx.mission.findMany({
      where: {
        status: "in_progress",
        type: { in: ["patrol", "survey", "salvage", "recon"] },
        durationTicks: { not: null },
        startedAtTick: { not: null },
      },
      select: {
        id: true,
        type: true,
        reward: true,
        playerId: true,
        shipId: true,
        startedAtTick: true,
        durationTicks: true,
        targetSystemId: true,
        targetSystem: { select: { name: true } },
        ship: { select: { name: true } },
      },
    });

    const playerEvents = new Map<string, Partial<PlayerEventMap>>();

    // Filter eligible missions in JS (duration check)
    const eligible = completedMissions.filter(
      (m) =>
        m.startedAtTick !== null &&
        m.durationTicks !== null &&
        m.startedAtTick + m.durationTicks <= ctx.tick,
    );

    if (eligible.length > 0) {
      const eligibleIds = eligible.map((m) => m.id);

      // Batch update all completed missions (1 query instead of N)
      await ctx.tx.mission.updateMany({
        where: { id: { in: eligibleIds } },
        data: {
          status: "completed",
          completedAtTick: ctx.tick,
          shipId: null, // free the ship
        },
      });

      // Aggregate rewards per player, then bulk credit with unnest()
      const rewardsByPlayer = new Map<string, number>();
      for (const m of eligible) {
        if (m.playerId) {
          rewardsByPlayer.set(m.playerId, (rewardsByPlayer.get(m.playerId) ?? 0) + m.reward);
        }
      }

      if (rewardsByPlayer.size > 0) {
        const playerIds = [...rewardsByPlayer.keys()];
        const rewards = playerIds.map((id) => rewardsByPlayer.get(id)!);

        await ctx.tx.$executeRaw`
          UPDATE "Player" AS p
          SET "credits" = p."credits" + batch."reward"
          FROM unnest(${playerIds}::text[], ${rewards}::int[])
            AS batch("id", "reward")
          WHERE p."id" = batch."id"`;
      }

      // Build notifications from already-fetched data (no extra queries)
      for (const mission of eligible) {
        if (mission.playerId) {
          addPlayerNotification(playerEvents, mission.playerId, {
            message: `${mission.type.charAt(0).toUpperCase() + mission.type.slice(1)} mission completed at ${mission.targetSystem.name} — earned ${mission.reward} CR`,
            type: "mission_completed",
            refs: {
              system: { id: mission.targetSystemId, label: mission.targetSystem.name },
              ...(mission.shipId && mission.ship ? { ship: { id: mission.shipId, label: mission.ship.name } } : {}),
            },
          });
        }
      }
    }

    // 3. Fail missions where accepted but past deadline and not yet started
    const failedMissions = await ctx.tx.mission.findMany({
      where: {
        deadlineTick: { lte: ctx.tick },
        status: "accepted",
      },
      select: {
        id: true,
        type: true,
        playerId: true,
        shipId: true,
        targetSystemId: true,
        targetSystem: { select: { name: true } },
        ship: { select: { name: true } },
      },
    });

    if (failedMissions.length > 0) {
      // Batch update all failed missions (1 query instead of N)
      await ctx.tx.mission.updateMany({
        where: { id: { in: failedMissions.map((m) => m.id) } },
        data: {
          status: "failed",
          shipId: null, // free the ship
        },
      });

      for (const mission of failedMissions) {
        if (mission.playerId) {
          addPlayerNotification(playerEvents, mission.playerId, {
            message: `${mission.type.charAt(0).toUpperCase() + mission.type.slice(1)} mission expired — ${mission.targetSystem.name}`,
            type: "mission_expired",
            refs: {
              system: { id: mission.targetSystemId, label: mission.targetSystem.name },
              ...(mission.shipId && mission.ship ? { ship: { id: mission.shipId, label: mission.ship.name } } : {}),
            },
          });
        }
      }
    }

    // ── Region round-robin candidate generation ──

    // 4. Determine target region for this tick
    const regions = await ctx.tx.region.findMany({
      select: { id: true, name: true, governmentType: true },
      orderBy: { name: "asc" },
    });

    if (regions.length === 0) {
      await persistPlayerNotifications(ctx.tx, playerEvents, ctx.tick);
      return {
        globalEvents: {
          opMissionsUpdated: [{ generated: 0, expired: expired.count }],
        },
        playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
      };
    }

    const regionIndex = ctx.tick % regions.length;
    const targetRegion = regions[regionIndex];

    // Fetch systems in the target region only
    const systems = await ctx.tx.starSystem.findMany({
      where: { regionId: targetRegion.id },
      select: {
        id: true,
        name: true,
        traits: { select: { traitId: true, quality: true } },
      },
    });

    const systemIds = systems.map((s) => s.id);

    // Fetch navigation modifiers scoped to target region's systems
    const navModifiers = systemIds.length > 0
      ? await ctx.tx.eventModifier.findMany({
          where: {
            domain: "navigation",
            targetType: "system",
            targetId: { in: systemIds },
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
        })
      : [];

    // Group modifiers by system
    const modsBySystem = groupModifiersByTarget(navModifiers);

    // Compute danger levels for each system in the region
    const govType = toGovernmentType(targetRegion.governmentType);
    const govDef = GOVERNMENT_TYPES[govType];
    const govBaseline = govDef?.dangerBaseline ?? 0;

    const dangerLevels = new Map<string, number>();
    for (const system of systems) {
      const traitDanger = computeTraitDanger(
        system.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      );
      const systemMods = modsBySystem.get(system.id) ?? [];
      const danger = computeSystemDanger(systemMods, govBaseline, traitDanger);
      dangerLevels.set(system.id, danger);
    }

    // Build system snapshots for engine
    const systemSnapshots: SystemSnapshot[] = systems.map((s) => ({
      id: s.id,
      name: s.name,
      traits: s.traits.map((t) => ({
        traitId: toTraitId(t.traitId),
        quality: toQualityTier(t.quality),
      })),
    }));

    const candidates = generateOpMissionCandidates(
      systemSnapshots,
      dangerLevels,
      ctx.tick,
      Math.random,
    );

    // 4b. Query active events at systems in this region for event-driven missions
    const activeEvents = systemIds.length > 0
      ? await ctx.tx.gameEvent.findMany({
          where: { systemId: { in: systemIds } },
          select: { id: true, type: true, systemId: true, severity: true },
        })
      : [];

    const eventContexts: EventMissionContext[] = activeEvents
      .filter((e): e is typeof e & { systemId: string } => e.systemId !== null)
      .map((e) => ({
        eventId: e.id,
        eventType: toEventTypeId(e.type),
        systemId: e.systemId,
        severity: e.severity,
      }));

    const eventCandidates = selectEventOpMissionCandidates(
      eventContexts,
      EVENT_OP_MISSIONS,
      dangerLevels,
      ctx.tick,
      Math.random,
    );

    // Merge event candidates into normal candidates
    for (const c of eventCandidates) candidates.push(c);

    // 5. Cap check scoped to the target region's systems
    let created = 0;
    if (candidates.length > 0) {
      const existingCounts = await ctx.tx.mission.groupBy({
        by: ["systemId"],
        where: {
          status: "available",
          systemId: { in: systemIds },
        },
        _count: { id: true },
      });

      const countBySystem = new Map(
        existingCounts.map((r) => [r.systemId, r._count.id]),
      );

      const toCreate: Array<{
        type: string;
        systemId: string;
        targetSystemId: string;
        reward: number;
        deadlineTick: number;
        durationTicks: number | null;
        enemyTier: string | null;
        statRequirements: string;
        createdAtTick: number;
        eventId: string | null;
      }> = [];

      const pendingBySystem = new Map<string, number>();

      for (const c of candidates) {
        const currentCount = countBySystem.get(c.systemId) ?? 0;
        const pendingCount = pendingBySystem.get(c.systemId) ?? 0;
        if (currentCount + pendingCount >= OP_MISSION_CAP_PER_SYSTEM) {
          continue;
        }

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

      if (toCreate.length > 0) {
        await ctx.tx.mission.createMany({ data: toCreate });
      }

      created = toCreate.length;
    }

    console.log(
      `[missions] Region ${regionIndex + 1}/${regions.length} "${targetRegion.name}" — expired ${expired.count}, completed ${completedMissions.length}, generated ${created} mission(s)`,
    );

    // Persist notifications to DB
    await persistPlayerNotifications(ctx.tx, playerEvents, ctx.tick);

    return {
      globalEvents: {
        opMissionsUpdated: [{ generated: created, expired: expired.count }],
      },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  },
};
