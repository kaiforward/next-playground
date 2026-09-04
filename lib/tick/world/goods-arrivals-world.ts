/**
 * GoodsArrivalsWorld — data interface for the goods-arrivals processor: the unconditional per-tick
 * stage that drains the scheduled-freight ledger (docs/planned/logistics-lanes.md §3), modelled on
 * `ShipArrivalsWorld` (`lib/tick/world/ship-arrivals-world.ts`).
 *
 * Implemented by `InMemoryGoodsArrivalsWorld` (`lib/tick/adapters/memory/goods-arrivals.ts`), which
 * `runWorldTick` wires into the shared pipeline. See
 * `docs/active/engineering/processor-architecture.md` for the broader pattern.
 */
import type { WorldPendingArrival } from "@/lib/world/types";

/** One flow row, written when the goods-arrivals stage credits an outbound leg's quantity onto its
 *  destination — the flow log's own record of goods actually delivered (a return leg writes none).
 *  Named for its writer: moved here from `directed-logistics-world.ts` once that module stopped
 *  writing flow rows itself (dispatch no longer credits a destination; see
 *  `docs/planned/logistics-lanes.md` §3). */
export interface ArrivalFlowInsert {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

/**
 * One market's band cap, keyed `"systemId|goodId"` (same composite `marketRowsBySystem`
 * (`lib/world/tick.ts`) gives every market row's `id`). A key absent from the map returned by
 * `getMarketCaps` means no market row exists at that destination (an undeveloped or dead system) —
 * the processor treats that as a zero cap, so the whole quantity returns to the donor.
 *
 * Carries `targetStock` alongside `stock`/`maxStock` — a deliberate widening past the band's
 * `{ stock; maxStock }` pair the credit rule alone needs, because `overshootVolume` (instrumentation
 * only) reads the same band's warehousing target rather than re-deriving it.
 */
export interface MarketCapView {
  stock: number;
  maxStock: number;
  targetStock: number;
}

/** Bulk absolute stock write (already computed by the caller). */
export interface MarketCreditUpdate {
  id: string;
  stock: number;
}

/** One ledger row's resolution this tick: how much of its quantity was credited, and — for an
 *  outbound leg whose quantity exceeded the destination's remaining room — the return leg minted
 *  for the uncredited remainder, or `null` when nothing was left over. */
export interface SettledArrival {
  id: string;
  credited: number;
  returned: WorldPendingArrival | null;
}

export interface GoodsArrivalsWorld {
  /** Ledger rows whose `arrivalTick` has come due (`<= tick`). */
  getDueArrivals(tick: number): Promise<WorldPendingArrival[]>;
  /** Band caps for the given `"systemId|goodId"` keys — every key a due row's destination touches. */
  getMarketCaps(keys: string[]): Promise<Map<string, MarketCapView>>;
  /** Bulk absolute stock writes (already clamped by the caller). */
  creditMarkets(updates: MarketCreditUpdate[]): Promise<void>;
  /** Drain each processed row from the ledger and append any minted return leg in its place. */
  settleArrivals(applied: SettledArrival[]): Promise<void>;
  /** Append flow rows for the credited quantity of outbound legs only — a return leg writes none. */
  appendFlows(flows: ArrivalFlowInsert[]): Promise<void>;
}
