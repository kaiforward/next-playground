import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowWorld, VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import type {
  SimConnection, SimFlowEvent, SimMarketEntry, SimSystem,
} from "@/lib/engine/simulator/types";

/**
 * In-memory adapter for the trade-flow processor.
 *
 * Owns mutable slices of the simulator's world for one runTradeFlowProcessor
 * call. Open edges are the unique same-faction (null===null for independents)
 * connections, sorted by key, each carrying fuelCost. The synthetic
 * MarketSnapshot.id ("${systemId}|${goodId}") round-trips into MarketUpdate.id.
 */
export class InMemoryTradeFlowWorld implements TradeFlowWorld {
  systems: SimSystem[];
  markets: SimMarketEntry[];
  flowEvents: SimFlowEvent[];
  private sysFactionCache: Map<string, string | null> | null = null;
  private openEdgesCache: EdgeView[] | null = null;

  constructor(
    initial: { systems: SimSystem[]; markets: SimMarketEntry[]; flowEvents: SimFlowEvent[] },
    private readonly connections: SimConnection[],
    /** Optional per-system player-volume injection for tests; sim baseline is empty. */
    private readonly playerVolumeBySystem: ReadonlyMap<string, number> = new Map(),
  ) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.flowEvents = [...initial.flowEvents];
  }

  private getSysFaction(): Map<string, string | null> {
    if (!this.sysFactionCache) {
      this.sysFactionCache = new Map(this.systems.map((s) => [s.id, s.factionId]));
    }
    return this.sysFactionCache;
  }

  getOpenEdges(): Promise<EdgeView[]> {
    if (this.openEdgesCache) return Promise.resolve(this.openEdgesCache);
    this.openEdgesCache = buildOpenEdges(this.connections, this.getSysFaction());
    return Promise.resolve(this.openEdgesCache);
  }

  getMarketSnapshotsForSystems(systemIds: string[]): Promise<MarketSnapshot[]> {
    const ids = new Set(systemIds);
    const snapshots: MarketSnapshot[] = [];
    for (const m of this.markets) {
      if (!ids.has(m.systemId)) continue;
      snapshots.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        goodId: m.goodId,
        basePrice: m.basePrice,
        stock: m.stock,
        anchorMult: m.anchorMult,
        demandRate: m.demandRate,
        priceFloor: m.priceFloor,
        priceCeiling: m.priceCeiling,
      });
    }
    return Promise.resolve(snapshots);
  }

  getRecentPlayerVolumeBySystem(systemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const id of systemIds) {
      const v = this.playerVolumeBySystem.get(id);
      if (v) result.set(id, v);
    }
    return Promise.resolve(result);
  }

  applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map<string, MarketUpdate>();
    for (const u of updates) byKey.set(u.id, u);
    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return { ...m, stock: isFinite(u.stock) ? u.stock : 0 };
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
