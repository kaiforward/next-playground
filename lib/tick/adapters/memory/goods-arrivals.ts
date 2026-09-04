import type {
  GoodsArrivalsWorld,
  MarketCapView,
  MarketCreditUpdate,
  SettledArrival,
} from "@/lib/tick/world/goods-arrivals-world";
import type { LogisticsFlowInsert } from "@/lib/tick/world/directed-logistics-world";
import type { WorldMarket, WorldPendingArrival } from "@/lib/world/types";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";

/**
 * In-memory adapter for the goods-arrivals processor, over `World.markets` and
 * `World.pendingArrivals`. Owns mutable copies of both for one processor run; the caller reads
 * `markets`, `pendingArrivals` and `flows` back via the public fields once the processor returns —
 * same shape as `MemoryDirectedLogisticsWorld` (`lib/tick/adapters/memory/directed-logistics.ts`).
 */
export class InMemoryGoodsArrivalsWorld implements GoodsArrivalsWorld {
  markets: WorldMarket[];
  pendingArrivals: WorldPendingArrival[];
  readonly flows: LogisticsFlowInsert[] = [];
  /** Calibration instrumentation only: Σ (stock after − stock before) this adapter actually wrote in
   *  `creditMarkets`, over every update whose market row was found — the fifth conservation
   *  identity's RIGHT-side credit term. A key the update list names but this adapter finds no
   *  matching row for contributes 0 here even though the processor's own tally may have counted it,
   *  which is exactly the drop this instrument exists to catch. */
  appliedCreditTotal = 0;

  constructor(initial: { markets: WorldMarket[]; pendingArrivals: WorldPendingArrival[] }) {
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.pendingArrivals = initial.pendingArrivals.map((a) => ({ ...a }));
  }

  getDueArrivals(tick: number): Promise<WorldPendingArrival[]> {
    return Promise.resolve(
      this.pendingArrivals.filter((a) => a.arrivalTick <= tick).map((a) => ({ ...a })),
    );
  }

  getMarketCaps(keys: string[]): Promise<Map<string, MarketCapView>> {
    const want = new Set(keys);
    const caps = new Map<string, MarketCapView>();
    for (const m of this.markets) {
      const key = `${m.systemId}|${m.goodId}`;
      if (!want.has(key)) continue;
      const good = GOODS[m.goodId];
      const band = marketBandForRow(m, good);
      caps.set(key, { stock: m.stock, maxStock: band.maxStock, targetStock: band.targetStock });
    }
    return Promise.resolve(caps);
  }

  creditMarkets(updates: MarketCreditUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map(updates.map((u) => [u.id, u.stock]));
    let applied = 0;
    this.markets = this.markets.map((m) => {
      const stock = byKey.get(`${m.systemId}|${m.goodId}`);
      if (stock === undefined) return m;
      applied += stock - m.stock;
      return { ...m, stock };
    });
    this.appliedCreditTotal += applied;
    return Promise.resolve();
  }

  settleArrivals(applied: SettledArrival[]): Promise<void> {
    const settledIds = new Set(applied.map((a) => a.id));
    const returns = applied
      .map((a) => a.returned)
      .filter((r): r is WorldPendingArrival => r !== null);
    this.pendingArrivals = [
      ...this.pendingArrivals.filter((a) => !settledIds.has(a.id)),
      ...returns,
    ];
    return Promise.resolve();
  }

  appendFlows(flows: LogisticsFlowInsert[]): Promise<void> {
    this.flows.push(...flows);
    return Promise.resolve();
  }
}
