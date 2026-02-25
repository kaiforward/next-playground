import type { TickProcessor, TickProcessorResult } from "../types";
import {
  generateOpMissionCandidates,
  type SystemSnapshot,
} from "@/lib/engine/mission-gen";
import { computeTraitDanger } from "@/lib/engine/trait-gen";
import { aggregateDangerLevel } from "@/lib/engine/danger";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { OP_MISSION_CAP_PER_SYSTEM } from "@/lib/constants/missions";
import { toGovernmentType, toTraitId, toQualityTier } from "@/lib/types/guards";
import type { ModifierRow } from "@/lib/engine/events";

export const missionsProcessor: TickProcessor = {
  name: "missions",
  frequency: 5,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    // 1. Expire unclaimed missions past deadline
    const expired = await ctx.tx.mission.deleteMany({
      where: {
        deadlineTick: { lte: ctx.tick },
        status: "available",
      },
    });

    // 2. Complete timed missions (patrol/survey) where commitment is done
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
        targetSystem: { select: { name: true } },
      },
    });

    const playerEvents = new Map<string, Record<string, unknown[]>>();

    for (const mission of completedMissions) {
      if (
        mission.startedAtTick === null ||
        mission.durationTicks === null ||
        mission.startedAtTick + mission.durationTicks > ctx.tick
      ) {
        continue;
      }

      // Complete the mission — credit the player
      await ctx.tx.mission.update({
        where: { id: mission.id },
        data: {
          status: "completed",
          completedAtTick: ctx.tick,
          shipId: null, // free the ship
        },
      });

      if (mission.playerId) {
        await ctx.tx.player.update({
          where: { id: mission.playerId },
          data: { credits: { increment: mission.reward } },
        });

        const existing = playerEvents.get(mission.playerId) ?? {};
        const notifications = existing["gameNotifications"] ?? [];
        notifications.push({
          message: `${mission.type.charAt(0).toUpperCase() + mission.type.slice(1)} mission completed at ${mission.targetSystem.name} — earned ${mission.reward} CR`,
          type: "mission_completed",
          refs: {},
        });
        existing["gameNotifications"] = notifications;
        playerEvents.set(mission.playerId, existing);
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
        targetSystem: { select: { name: true } },
      },
    });

    for (const mission of failedMissions) {
      await ctx.tx.mission.update({
        where: { id: mission.id },
        data: {
          status: "failed",
          shipId: null, // free the ship
        },
      });

      if (mission.playerId) {
        const existing = playerEvents.get(mission.playerId) ?? {};
        const notifications = existing["gameNotifications"] ?? [];
        notifications.push({
          message: `${mission.type.charAt(0).toUpperCase() + mission.type.slice(1)} mission expired — ${mission.targetSystem.name}`,
          type: "mission_expired",
          refs: {},
        });
        existing["gameNotifications"] = notifications;
        playerEvents.set(mission.playerId, existing);
      }
    }

    // 4. Generate new candidates
    // Fetch all systems with traits for survey eligibility + danger computation
    const systems = await ctx.tx.starSystem.findMany({
      select: {
        id: true,
        name: true,
        traits: { select: { traitId: true, quality: true } },
        region: { select: { governmentType: true } },
      },
    });

    // Fetch navigation modifiers for danger computation
    const navModifiers = await ctx.tx.eventModifier.findMany({
      where: {
        domain: "navigation",
        targetType: "system",
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

    // Group modifiers by system
    const modsBySystem = new Map<string, ModifierRow[]>();
    for (const mod of navModifiers) {
      if (!mod.targetId) continue;
      const existing = modsBySystem.get(mod.targetId) ?? [];
      existing.push(mod);
      modsBySystem.set(mod.targetId, existing);
    }

    // Compute danger levels for each system
    const dangerLevels = new Map<string, number>();
    for (const system of systems) {
      const govType = toGovernmentType(system.region.governmentType);
      const govDef = govType ? GOVERNMENT_TYPES[govType] : undefined;
      const govBaseline = govDef?.dangerBaseline ?? 0;
      const traitDanger = computeTraitDanger(
        system.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      );
      const systemMods = modsBySystem.get(system.id) ?? [];
      const danger = Math.max(0, Math.min(
        aggregateDangerLevel(systemMods) + govBaseline + traitDanger,
        0.5,
      ));
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

    // 5. Cap check per system
    if (candidates.length > 0) {
      const existingCounts = await ctx.tx.mission.groupBy({
        by: ["systemId"],
        where: { status: "available" },
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
      }> = [];

      for (const c of candidates) {
        const currentCount = countBySystem.get(c.systemId) ?? 0;
        if (
          currentCount + toCreate.filter((t) => t.systemId === c.systemId).length >=
          OP_MISSION_CAP_PER_SYSTEM
        ) {
          continue;
        }

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
        });
      }

      if (toCreate.length > 0) {
        await ctx.tx.mission.createMany({ data: toCreate });
      }

      console.log(
        `[missions] Expired ${expired.count} available, completed ${completedMissions.length} timed, generated ${toCreate.length} operational mission(s)`,
      );
    }

    return {
      globalEvents: {
        opMissionsUpdated: [{ generated: candidates.length, expired: expired.count }],
      },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  },
};
