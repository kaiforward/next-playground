import type { TxClient, PlayerEventMap } from "@/lib/tick/types";
import type {
  CompletableMissionView,
  EventContextView,
  FailedMissionView,
  MissionCreate,
  OpMissionsWorld,
  SystemTraitView,
} from "@/lib/tick/world/op-missions-world";
import type { ModifierRow } from "@/lib/engine/events";
import { persistPlayerNotifications } from "@/lib/tick/helpers";
import {
  toEventTypeId,
  toGovernmentType,
  toQualityTier,
  toTraitId,
} from "@/lib/types/guards";

/** Live-game adapter for the operational-missions processor. */
export class PrismaOpMissionsWorld implements OpMissionsWorld {
  constructor(private tx: TxClient) {}

  async expireUnclaimedMissions(currentTick: number): Promise<number> {
    const result = await this.tx.mission.deleteMany({
      where: { deadlineTick: { lte: currentTick }, status: "available" },
    });
    return result.count;
  }

  async getCompletableTimedMissions(
    currentTick: number,
  ): Promise<CompletableMissionView[]> {
    const rows = await this.tx.mission.findMany({
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

    const eligible: CompletableMissionView[] = [];
    for (const m of rows) {
      if (m.startedAtTick === null || m.durationTicks === null) continue;
      if (m.startedAtTick + m.durationTicks > currentTick) continue;
      eligible.push({
        id: m.id,
        type: m.type,
        reward: m.reward,
        playerId: m.playerId,
        shipId: m.shipId,
        startedAtTick: m.startedAtTick,
        durationTicks: m.durationTicks,
        targetSystemId: m.targetSystemId,
        targetSystemName: m.targetSystem.name,
        shipName: m.ship?.name ?? null,
      });
    }
    return eligible;
  }

  async completeMissions(ids: string[], currentTick: number): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.mission.updateMany({
      where: { id: { in: ids } },
      data: { status: "completed", completedAtTick: currentTick, shipId: null },
    });
  }

  async creditPlayers(rewardsByPlayer: Map<string, number>): Promise<void> {
    if (rewardsByPlayer.size === 0) return;
    const playerIds = [...rewardsByPlayer.keys()];
    const rewards = playerIds.map((id) => rewardsByPlayer.get(id)!);
    await this.tx.$executeRaw`
      UPDATE "Player" AS p
      SET "credits" = p."credits" + batch."reward"
      FROM unnest(${playerIds}::text[], ${rewards}::int[])
        AS batch("id", "reward")
      WHERE p."id" = batch."id"`;
  }

  async getFailedAcceptedMissions(
    currentTick: number,
  ): Promise<FailedMissionView[]> {
    const rows = await this.tx.mission.findMany({
      where: { deadlineTick: { lte: currentTick }, status: "accepted" },
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
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      playerId: m.playerId,
      shipId: m.shipId,
      targetSystemId: m.targetSystemId,
      targetSystemName: m.targetSystem.name,
      shipName: m.ship?.name ?? null,
    }));
  }

  async failMissions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.mission.updateMany({
      where: { id: { in: ids } },
      data: { status: "failed", shipId: null },
    });
  }

  async getSystemIds(): Promise<string[]> {
    const rows = await this.tx.starSystem.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => r.id);
  }

  async getSystemsByIds(systemIds: string[]): Promise<SystemTraitView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: {
        id: true,
        name: true,
        bodyDanger: true,
        faction: { select: { governmentType: true } },
        traits: { select: { traitId: true, quality: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      bodyDanger: s.bodyDanger,
      // `?? "frontier"` is the safe fallback for the only legitimate gap: a
      // system observed mid-write before its factionId column is populated.
      // The seed guarantees a non-null factionId on every system.
      governmentType: s.faction?.governmentType
        ? toGovernmentType(s.faction.governmentType)
        : "frontier",
      traits: s.traits.map((t) => ({
        traitId: toTraitId(t.traitId),
        quality: toQualityTier(t.quality),
      })),
    }));
  }

  async getNavModifiersForSystems(
    systemIds: string[],
  ): Promise<ModifierRow[]> {
    if (systemIds.length === 0) return [];
    return this.tx.eventModifier.findMany({
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
    });
  }

  async getActiveEventsForSystems(
    systemIds: string[],
  ): Promise<EventContextView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.gameEvent.findMany({
      where: { systemId: { in: systemIds } },
      select: { id: true, type: true, systemId: true, severity: true },
    });
    return rows
      .filter((e): e is typeof e & { systemId: string } => e.systemId !== null)
      .map((e) => ({
        id: e.id,
        type: toEventTypeId(e.type),
        systemId: e.systemId,
        severity: e.severity,
      }));
  }

  async getMissionCountsBySystem(
    systemIds: string[],
  ): Promise<Map<string, number>> {
    if (systemIds.length === 0) return new Map();
    const rows = await this.tx.mission.groupBy({
      by: ["systemId"],
      where: { status: "available", systemId: { in: systemIds } },
      _count: { id: true },
    });
    return new Map(rows.map((r) => [r.systemId, r._count.id]));
  }

  async createMissions(rows: MissionCreate[]): Promise<void> {
    if (rows.length === 0) return;
    await this.tx.mission.createMany({ data: rows });
  }

  async persistNotifications(
    events: Map<string, Partial<PlayerEventMap>>,
    tick: number,
  ): Promise<void> {
    await persistPlayerNotifications(this.tx, events, tick);
  }
}
