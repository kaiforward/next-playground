import type { TickProcessorResult } from "../types";
import type {
  GoodsArrivalsWorld,
  SettledArrival,
  ArrivalFlowInsert,
} from "@/lib/tick/world/goods-arrivals-world";
import type { WorldPendingArrival } from "@/lib/world/types";

export interface GoodsArrivalsProcessorParams {
  /** Mints a fresh, globally-unique id for a return leg — the same `world.nextId` counter every
   *  other tick-minted id draws from. */
  mintId: () => string;
}

/**
 * Pure processor body — the unconditional per-tick stage that drains the scheduled-freight ledger
 * (docs/planned/logistics-lanes.md §3), modelled on `runShipArrivalsProcessor`. Runs every tick,
 * never gated on any cadence: quantising arrivals up to a logistics boundary would delay every
 * haul by up to a full interval and put the zero-latency fallback (a high `FREIGHT_SPEED`)
 * permanently out of reach.
 *
 * **Outbound legs** credit up to the destination's band cap (`marketBandForRow(...).maxStock`,
 * read via `GoodsArrivalsWorld.getMarketCaps`); a destination with no market row at all (an
 * undeveloped or dead system) reads as a zero cap, so the whole quantity returns. Any uncredited
 * remainder is minted as a fresh `leg: "return"` row back toward the donor over the reversed
 * `routeEdges`, arriving after the SAME transit delay (`arrivalTick − dispatchTick`) the outbound
 * leg took. A credited outbound quantity writes one flow row; an uncredited (fully-returned)
 * outbound writes none.
 *
 * **Return legs** credit their target (the original donor) in full, uncapped — the
 * cancelled-colony precedent (staged materials return uncapped, docs/active/gameplay/
 * player-seat.md Cancel) — and write no flow row, so the flow log stays a record of goods actually
 * delivered, never of goods bouncing back.
 *
 * `overshootVolume` is instrumentation only, never a decision input (read by the calibration
 * harness only): the part of each outbound credit landing on a market whose PRE-credit stock already sat
 * at or above its logistics warehousing target (`marketBandForRow(...).targetStock` — the same
 * anchor the matcher's own classification reads elsewhere, read here rather than re-derived).
 *
 * Multiple due rows targeting the same `(systemId, goodId)` in one tick are applied in ledger
 * order, each reading the running post-credit stock of the ones before it — never the market's
 * pre-tick stock for every row — so two arrivals to one market this tick cannot both credit into
 * the same headroom.
 */
export async function runGoodsArrivalsProcessor(
  world: GoodsArrivalsWorld,
  ctx: { tick: number },
  params: GoodsArrivalsProcessorParams,
): Promise<
  TickProcessorResult & {
    goodsArrivals: { credited: number; returned: number; returnedRows: number; overshootVolume: number };
  }
> {
  const due = await world.getDueArrivals(ctx.tick);

  const empty = {
    goodsArrivals: { credited: 0, returned: 0, returnedRows: 0, overshootVolume: 0 },
  };
  if (due.length === 0) return empty;

  const keys = Array.from(new Set(due.map((row) => `${row.toSystemId}|${row.goodId}`)));
  const caps = await world.getMarketCaps(keys);

  // Running post-credit stock per touched market key, seeded from this tick's caps view and
  // advanced as each due row is applied — see the ordering note in the docstring above.
  const runningStock = new Map<string, number>();
  for (const [key, cap] of caps) runningStock.set(key, cap.stock);

  const settled: SettledArrival[] = [];
  const flows: ArrivalFlowInsert[] = [];
  let creditedTotal = 0;
  let returnedTotal = 0;
  let returnedRows = 0;
  let overshootVolume = 0;

  for (const row of due) {
    const key = `${row.toSystemId}|${row.goodId}`;
    const stockBefore = runningStock.get(key) ?? 0;

    if (row.leg === "return") {
      // A return leg's destination is the original donor, which — unlike an outbound leg's
      // destination — has no cap-driven room test: it credits in full, uncapped (the
      // cancelled-colony precedent). But `creditMarkets` writes nothing for an id with no market
      // row (an unreachable case today: market rows are never deleted, only reset), so crediting
      // into `runningStock` for a key `caps` never returned would mint units `creditMarkets` then
      // silently drops. Leave such a row unsettled instead — it stays in the ledger and retries
      // next tick — rather than count it credited and lose it.
      const cap = caps.get(key);
      if (!cap) continue;
      runningStock.set(key, stockBefore + row.quantity);
      creditedTotal += row.quantity;
      settled.push({ id: row.id, credited: row.quantity, returned: null });
      continue;
    }

    const cap = caps.get(key);
    const maxStock = cap?.maxStock ?? 0;
    const room = Math.max(0, maxStock - stockBefore);
    const credited = Math.min(row.quantity, room);
    const remainder = row.quantity - credited;

    if (credited > 0) {
      runningStock.set(key, stockBefore + credited);
      creditedTotal += credited;
      flows.push({
        tick: ctx.tick,
        fromSystemId: row.fromSystemId,
        toSystemId: row.toSystemId,
        goodId: row.goodId,
        quantity: credited,
      });
      const targetStock = cap?.targetStock ?? 0;
      if (stockBefore >= targetStock) overshootVolume += credited;
    }

    let returnedRow: WorldPendingArrival | null = null;
    if (remainder > 0) {
      const delay = row.arrivalTick - row.dispatchTick;
      returnedRow = {
        id: params.mintId(),
        factionId: row.factionId,
        fromSystemId: row.toSystemId,
        toSystemId: row.fromSystemId,
        goodId: row.goodId,
        quantity: remainder,
        dispatchTick: ctx.tick,
        arrivalTick: ctx.tick + delay,
        routeEdges: [...row.routeEdges].reverse(),
        leg: "return",
      };
      returnedTotal += remainder;
      returnedRows += 1;
    }

    settled.push({ id: row.id, credited, returned: returnedRow });
  }

  const creditUpdates = Array.from(runningStock, ([id, stock]) => ({ id, stock }));
  await world.creditMarkets(creditUpdates);
  await world.settleArrivals(settled);
  await world.appendFlows(flows);

  return {
    goodsArrivals: { credited: creditedTotal, returned: returnedTotal, returnedRows, overshootVolume },
  };
}
