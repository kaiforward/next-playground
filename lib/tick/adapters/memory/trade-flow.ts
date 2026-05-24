import type {
  EdgeView,
  FlowEventInsert,
  MarketSnapshot,
  MarketUpdate,
  RegionView,
  TradeFlowWorld,
  VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";
import type {
  SimConnection,
  SimFlowEvent,
  SimMarketEntry,
  SimRegion,
  SimSystem,
} from "@/lib/engine/simulator/types";

/**
 * In-memory adapter for the trade-flow processor.
 *
 * Owns mutable slices of the simulator's world for the duration of one
 * `runTradeFlowProcessor` call. Markets, systems, and flow events are
 * mutated in place; the caller reads the final arrays via the public fields
 * once the processor returns.
 *
 * The synthetic `MarketSnapshot.id` (`"${systemId}|${goodId}"`) round-trips
 * into `MarketUpdate.id`, letting the adapter locate the underlying
 * SimMarketEntry by composite key on write.
 */
export class InMemoryTradeFlowWorld implements TradeFlowWorld {
  systems: SimSystem[];
  markets: SimMarketEntry[];
  flowEvents: SimFlowEvent[];

  constructor(
    initial: {
      systems: SimSystem[];
      markets: SimMarketEntry[];
      flowEvents: SimFlowEvent[];
    },
    private readonly regions: SimRegion[],
    private readonly connections: SimConnection[],
    /**
     * Optional player-pressure injection for tests — the simulator itself
     * has no TradeHistory equivalent, so production sim runs see 0.
     */
    private readonly playerVolumeByRegion: ReadonlyMap<string, number> = new Map(),
  ) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.flowEvents = [...initial.flowEvents];
  }

  getRegions(): Promise<RegionView[]> {
    const sorted = [...this.regions].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return Promise.resolve(
      sorted.map((r) => ({
        id: r.id,
        name: r.name,
        governmentType: r.governmentType,
      })),
    );
  }

  getEdgesForRegion(regionId: string): Promise<EdgeView[]> {
    const sysRegion = new Map(this.systems.map((s) => [s.id, s.regionId]));
    const seen = new Set<string>();
    const edges: EdgeView[] = [];
    for (const c of this.connections) {
      if (c.fromSystemId === c.toSystemId) continue;
      if (
        sysRegion.get(c.fromSystemId) !== regionId ||
        sysRegion.get(c.toSystemId) !== regionId
      ) {
        continue;
      }
      const [a, b] =
        c.fromSystemId < c.toSystemId
          ? [c.fromSystemId, c.toSystemId]
          : [c.toSystemId, c.fromSystemId];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ aSystemId: a, bSystemId: b });
    }
    return Promise.resolve(edges);
  }

  getMarketSnapshotsForRegion(regionId: string): Promise<MarketSnapshot[]> {
    const sysRegion = new Map(this.systems.map((s) => [s.id, s.regionId]));
    const snapshots: MarketSnapshot[] = [];
    for (const m of this.markets) {
      if (sysRegion.get(m.systemId) !== regionId) continue;
      snapshots.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        goodId: m.goodId,
        basePrice: m.basePrice,
        supply: m.supply,
        demand: m.demand,
        priceFloor: m.priceFloor,
        priceCeiling: m.priceCeiling,
      });
    }
    return Promise.resolve(snapshots);
  }

  getRecentPlayerVolume(regionId: string): Promise<number> {
    return Promise.resolve(this.playerVolumeByRegion.get(regionId) ?? 0);
  }

  applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map<string, MarketUpdate>();
    for (const u of updates) byKey.set(u.id, u);

    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return {
        ...m,
        supply: isFinite(u.supply) ? u.supply : 0,
        demand: isFinite(u.demand) ? u.demand : 0,
      };
    });
    return Promise.resolve();
  }

  applyVolumeIncrements(increments: VolumeIncrement[]): Promise<void> {
    if (increments.length === 0) return Promise.resolve();
    const bySystem = new Map<string, number>();
    for (const inc of increments) {
      const amount = isFinite(inc.amount) ? Math.round(inc.amount) : 0;
      bySystem.set(inc.systemId, (bySystem.get(inc.systemId) ?? 0) + amount);
    }

    this.systems = this.systems.map((s) => {
      const delta = bySystem.get(s.id);
      if (!delta) return s;
      return { ...s, tradeVolumeAccum: s.tradeVolumeAccum + delta };
    });
    return Promise.resolve();
  }

  appendFlowEvents(events: FlowEventInsert[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    this.flowEvents.push(...events);
    return Promise.resolve();
  }

  pruneFlowEvents(beforeTick: number): Promise<void> {
    this.flowEvents = this.flowEvents.filter((e) => e.tick >= beforeTick);
    return Promise.resolve();
  }
}
