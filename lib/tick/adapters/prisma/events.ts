import type { TxClient } from "@/lib/tick/types";
import type {
  EventCreate,
  EventCreateResult,
  EventsWorld,
  EventWithName,
  NeighborWithName,
  PhaseAdvance,
  SystemShock,
  SystemWithName,
} from "@/lib/tick/world/events-world";
import type { ModifierRow } from "@/lib/engine/events";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { toEventTypeId } from "@/lib/types/guards";

/** Live-game adapter. Bulk-writes via unnest() and createMany live here. */
export class PrismaEventsWorld implements EventsWorld {
  constructor(private tx: TxClient) {}

  async getEvents(): Promise<EventWithName[]> {
    const rows = await this.tx.gameEvent.findMany({
      select: {
        id: true,
        type: true,
        phase: true,
        systemId: true,
        regionId: true,
        startTick: true,
        phaseStartTick: true,
        phaseDuration: true,
        severity: true,
        sourceEventId: true,
        system: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      type: toEventTypeId(r.type),
      phase: r.phase,
      systemId: r.systemId,
      regionId: r.regionId,
      startTick: r.startTick,
      phaseStartTick: r.phaseStartTick,
      phaseDuration: r.phaseDuration,
      severity: r.severity,
      sourceEventId: r.sourceEventId,
      systemName: r.system?.name ?? null,
    }));
  }

  async getSystems(): Promise<SystemWithName[]> {
    const rows = await this.tx.starSystem.findMany({
      select: { id: true, name: true, economyType: true, regionId: true },
    });
    return rows;
  }

  async getNeighborsBySystem(
    systemIds: string[],
  ): Promise<Map<string, NeighborWithName[]>> {
    if (systemIds.length === 0) return new Map();

    const connections = await this.tx.systemConnection.findMany({
      where: { fromSystemId: { in: systemIds } },
      select: {
        fromSystemId: true,
        toSystem: {
          select: { id: true, name: true, economyType: true, regionId: true },
        },
      },
    });

    const result = new Map<string, NeighborWithName[]>();
    for (const c of connections) {
      let list = result.get(c.fromSystemId);
      if (!list) {
        list = [];
        result.set(c.fromSystemId, list);
      }
      list.push({
        id: c.toSystem.id,
        name: c.toSystem.name,
        economyType: c.toSystem.economyType,
        regionId: c.toSystem.regionId,
      });
    }
    return result;
  }

  async advancePhases(advances: PhaseAdvance[]): Promise<void> {
    if (advances.length === 0) return;

    const advancingIds = advances.map((a) => a.eventId);

    // Replace modifier rows: batch delete then batch create.
    await this.tx.eventModifier.deleteMany({
      where: { eventId: { in: advancingIds } },
    });

    const modifierRows = advances.flatMap((a) =>
      a.modifiers.map((m) => ({ eventId: a.eventId, ...m })),
    );
    if (modifierRows.length > 0) {
      await this.tx.eventModifier.createMany({ data: modifierRows });
    }

    // Batch update event phases with unnest() (1 query for N events).
    const phaseNames = advances.map((a) => a.nextPhaseName);
    const phaseTicks = advances.map((a) => a.phaseStartTick);
    const phaseDurations = advances.map((a) => a.phaseDuration);

    await this.tx.$executeRaw`
      UPDATE "GameEvent" AS ge
      SET "phase" = batch."phase",
          "phaseStartTick" = batch."phaseStartTick",
          "phaseDuration" = batch."phaseDuration"
      FROM unnest(
        ${advancingIds}::text[],
        ${phaseNames}::text[],
        ${phaseTicks}::int[],
        ${phaseDurations}::int[]
      ) AS batch("id", "phase", "phaseStartTick", "phaseDuration")
      WHERE ge."id" = batch."id"`;
  }

  async expireEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    // Modifiers cascade via onDelete: Cascade in the schema.
    await this.tx.gameEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  async createEvents(creates: EventCreate[]): Promise<EventCreateResult[]> {
    if (creates.length === 0) return [];

    const createdEvents = await this.tx.gameEvent.createManyAndReturn({
      data: creates.map((c) => ({
        type: c.type,
        phase: c.phase,
        systemId: c.systemId,
        regionId: c.regionId,
        startTick: c.startTick,
        phaseStartTick: c.phaseStartTick,
        phaseDuration: c.phaseDuration,
        severity: c.severity,
        sourceEventId: c.sourceEventId,
      })),
      select: {
        id: true,
        systemId: true,
        system: { select: { name: true } },
      },
    });

    const modifierRows: Array<{ eventId: string } & ModifierRow> = [];
    for (let i = 0; i < creates.length; i++) {
      for (const m of creates[i].modifiers) {
        modifierRows.push({ eventId: createdEvents[i].id, ...m });
      }
    }
    if (modifierRows.length > 0) {
      await this.tx.eventModifier.createMany({ data: modifierRows });
    }

    return createdEvents.map((e) => ({
      eventId: e.id,
      systemName: e.system?.name ?? "Unknown",
    }));
  }

  async applyShocks(shocks: SystemShock[]): Promise<number> {
    if (shocks.length === 0) return 0;

    const { MIN_LEVEL, MAX_LEVEL } = ECONOMY_CONSTANTS;

    // Unique system IDs targeted by shocks.
    const systemIds = [...new Set(shocks.map((s) => s.systemId))];

    // Single query: fetch all markets at affected systems.
    const allMarkets = await this.tx.stationMarket.findMany({
      where: { station: { systemId: { in: systemIds } } },
      select: {
        id: true,
        stock: true,
        goodId: true,
        station: { select: { systemId: true } },
      },
    });
    if (allMarkets.length === 0) return 0;

    const marketByKey = new Map<string, { id: string; stock: number }>();
    for (const m of allMarkets) {
      marketByKey.set(`${m.station.systemId}|${m.goodId}`, {
        id: m.id,
        stock: m.stock,
      });
    }

    // Aggregate shock deltas onto the single stock axis. A "supply" shock moves
    // stock directly; a "demand" shock moves it inversely (more demand →
    // scarcer → lower stock). Both modes honored at this layer.
    const touchedIds = new Set<string>();
    for (const shock of shocks) {
      const market = marketByKey.get(`${shock.systemId}|${shock.goodId}`);
      if (!market) continue;
      if (!isFinite(shock.value)) continue;

      const delta =
        shock.mode === "percentage" ? Math.round(market.stock * shock.value) : shock.value;
      market.stock += shock.parameter === "supply" ? delta : -delta;
      touchedIds.add(market.id);
    }

    if (touchedIds.size === 0) return 0;

    const ids: string[] = [];
    const stocks: number[] = [];

    for (const market of marketByKey.values()) {
      if (!touchedIds.has(market.id)) continue;
      ids.push(market.id);
      const s = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, market.stock));
      stocks.push(isFinite(s) ? s : 0);
    }

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock"
      FROM unnest(${ids}::text[], ${stocks}::double precision[])
        AS batch("id", "stock")
      WHERE sm."id" = batch."id"`;

    return ids.length;
  }
}
