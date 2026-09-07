/**
 * Shared per-system market-state derivation for the directed-logistics matcher and
 * the directed-build planner. Given one system's buildings/population/yields and its
 * market rows, produce the engine's GoodMarketState[]: per good, current stock, the two lines the
 * match trades on (the want `logisticsTarget` and the give-down-to `donorReserve`), and the two
 * demand figures. One definition so both processors read markets identically.
 *
 * The two lines are authored from the market's ROLE (`classifyLogisticsRole`), which this is the
 * one site to resolve: a producer and a supplier — a world its own part-production or a steady,
 * punctual inbound stream keeps topped up — hold a thin restart buffer and re-order just above it,
 * both immune to anchor shifts; a consumer reserves against what it has ACTUALLY been using, never
 * below that buffer, so a world eating the good at full rate keeps the lines it always kept and a
 * refinery that has stopped drawing collapses onto the buffer. The role rides out on the state
 * alongside `marginFree` (the give line is a buffer, so it is given down to without a dead-band)
 * and `consumerDeepLine` (what a full-rate consumer here would have kept, whatever this market's
 * own role, which is what a colony's staging draw is capped at). Every line is multiplied by the
 * owning faction's `stockpileScale`, which leaves the ratios between them untouched.
 *
 * `demand` is the USE figure — what this system's population and industry draw when running. It
 * moves only as buildings, population and strike state move, which is what every warehousing
 * quantity here requires: a target that followed the momentary state of the yard it stocks would
 * drain and refill forever. `drawDemand` is the DRAW figure — the same want further gated by each
 * consuming factory's own output brake and live event multipliers, i.e. how urgently a delivery is
 * needed right now. Only the matcher's ordering cover reads it — the level and every raise stay
 * sized on `demand`.
 *
 * Everything here divides by REAL demand — deliberately not the row's `demandRate`, which floors at
 * `MIN_DEMAND` (a divide-by-zero guard on *pricing*) and below that floor describes the guard rather
 * than anything consumed locally. One anchor-derived quantity is read deliberately, and only one:
 * `anchorMult` scales a consumer's deep terms — the want and the give line move together under an
 * anchor-shifting event, while the buffer terms every role floors at stay immune to it — and rides
 * the brake knee's use term. The draw figure's brake measures each consumer's
 * stock against the same warehouse knee (`brakeKnee` — use figure and capacity) the economy
 * actually brakes production with — urgency mirrors the brake as applied. The pricing
 * `demandRate` itself reaches nothing here.
 */
import type { ResourceVector } from "@/lib/types/game";
import { ECONOMY_SIM_PARAMS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { capacityGoodRates } from "@/lib/engine/industry";
import { drawRatesByGood, useRatesByGood } from "@/lib/engine/honest-demand";
import type { UseRate } from "@/lib/engine/honest-demand";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { brakeKnee, productionCeiling } from "@/lib/engine/tick";
import { logisticsLinesFor, type GoodMarketState } from "@/lib/engine/directed-logistics";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

/**
 * Which brake the draw figure's `brakeCeilingOf` reads. `"live"` (the default and the only value
 * the live game ever uses) is the warehouse knee the economy actually brakes production with;
 * `"anchor"` pins it to the retired anchor-based ceiling — a committed harness override for the
 * stage-gate's third A/B arm, so the brake's direct effect and its logistics-urgency ripple are
 * attributable separately. It rides `runWorldTick`'s opts channel exactly as the cadence override
 * does, and reaches nothing but the draw figure.
 *
 * The single source for both the type and the Zod boundary (`experiment.ts`) — a third arm added
 * here is a compile error everywhere else until named, rather than a schema that silently rejects
 * (or silently accepts) whatever the type union no longer agrees with.
 */
export const DRAW_BRAKE_CEILINGS = ["live", "anchor"] as const;
export type DrawBrakeCeiling = (typeof DRAW_BRAKE_CEILINGS)[number];

/**
 * The one resolution of a system's faction to its stockpile scale — every `toGoodMarketStates`
 * caller (the tick processors and the harness alike) reads this rather than indexing the map
 * itself, so the "independent reads 1, missing row reads 1" rule cannot drift between call sites.
 * `factionId === null` is an unowned system, which has no treasury row to begin with.
 */
export function stockpileScaleFor(
  factionId: string | null,
  byFaction: ReadonlyMap<string, number>,
): number {
  return factionId === null ? 1 : (byFaction.get(factionId) ?? 1);
}

/**
 * The retired anchor brake's hold cover at retirement — BRAKE_RAMP's value on the day this brake
 * was pinned as the third-arm control. Deliberately a fixed historical literal, NOT a live read of
 * `ECONOMY_CONSTANTS.BRAKE_RAMP`: the two happen to agree today, but the control must stay fixed
 * while the treatment (the live knee's own ramp) is retuned, or a later BRAKE_RAMP change would
 * silently move the A/B baseline along with the arm it is meant to be a fixed comparison against.
 */
const RETIRED_HOLD_COVER = 1.3;

/**
 * The retired anchor brake, kept ONLY as the third-arm pin: full rate to the price anchor, linear
 * taper to 0 at RETIRED_HOLD_COVER × anchor (the geometry the warehouse knee replaced). A
 * measurement arm, never a gameplay path.
 */
export function anchorCeiling(stock: number, targetStock: number): number {
  if (targetStock <= 0) return 0;
  const end = targetStock * RETIRED_HOLD_COVER;
  if (stock <= targetStock) return 1;
  if (stock >= end) return 0;
  return (end - stock) / (end - targetStock);
}

/** Minimal per-system shape both processors derive market state from. */
export interface MarketStateSource {
  buildings: Record<string, number>;
  population: number;
  yields: ResourceVector;
  /** Per-resource extraction-work efficiency, threaded alongside `yields`; absent ⇒ neutral 1.0
   *  (the same convention `capacityGoodRates`'s own default carries). */
  extractionEff?: ResourceVector;
  markets: MarketRowForLogistics[];
}

export function toGoodMarketStates(
  row: MarketStateSource,
  opts: {
    withDraw?: boolean;
    drawBrakeCeiling?: DrawBrakeCeiling;
    /** Goods already dispatched toward this system for this good, not yet arrived
     *  (`GoodMarketState.scheduledInbound`) — read ONLY at the directed-logistics matcher's call
     *  site (`toLogisticsState`), so the sink test sees `stock + scheduledInbound`
     *  (docs/active/gameplay/logistics-lanes.md §3). The build planner's call site omits this hook
     *  entirely, keeping physical stock alone for its own structural-deficit reads. */
    scheduledInboundFor?: (goodId: string) => number;
    /** The owning faction's stockpile scale, multiplying every line of every role. Every caller
     *  resolves this explicitly (via `stockpileScaleFor`) — 1 for an unowned system or a faction
     *  with no treasury row — a REQUIRED option so a caller that forgets it fails `tsc` rather than
     *  silently reading the neutral default. */
    stockpileScale: number;
  },
): GoodMarketState[] {
  const stockpileScale = opts.stockpileScale;
  const rates = capacityGoodRates(row.buildings, row.population, row.yields, row.extractionEff);
  const consByKey = new Map(rates.map((r) => [r.goodId, r.consumption]));
  const prodByKey = new Map(rates.map((r) => [r.goodId, r.production]));

  // The strike × maintenance scalar is a property of the system, so every row that carries it
  // carries the same value; rows written before it existed read as unsuppressed.
  const suppressRow = row.markets.find((m) => typeof m.productionSuppressRate === "number");
  const productionSuppress = suppressRow?.productionSuppressRate ?? 1;

  // Only a row with no persisted use figure needs the recompute, so it is paid for lazily.
  let useRates: Map<string, UseRate> | undefined;
  const recomputedUseRate = (goodId: string): number => {
    useRates ??= useRatesByGood({
      buildings: row.buildings,
      population: row.population,
      yields: row.yields,
      extractionEff: row.extractionEff,
      productionSuppress,
      rates,
    });
    return useRates.get(goodId)?.total ?? 0;
  };
  // A missing or corrupt use figure recomputes live — it must never read as 0, which would make
  // the row an un-sinkable market and a fully-drawable donor at the same time (and here, a
  // zero-knee brake). One resolution feeds the brake pass and the published `demand` alike.
  const useRateOf = (m: MarketRowForLogistics): number =>
    typeof m.honestUseRate === "number" && Number.isFinite(m.honestUseRate)
      ? m.honestUseRate
      : recomputedUseRate(m.goodId);

  // The draw figure has exactly one reader — the matcher's ordering cover, which decides which
  // shelf is served first — so only the logistics caller pays for the per-market brake pass and the
  // second recipe sum behind it.
  //
  // This brake pass is LOAD-BEARING for welfare, not a refinement: the stage-3 gate's third arm
  // (draw figure pinned to the old anchor ceiling, tick brake identical) measured the brake's
  // direct effect on consumers as mildly negative and the ripple through this gate as the entire
  // net gain (pop 100-1K supplied +11.8pp, electronics cover +0.43, B′−C′). Simplifying
  // `brakeCeilingOf` out of the draw figure would silently give those gains back.
  let drawRates: Map<string, number> | undefined;
  if (opts.withDraw) {
    // Each good's own output brake at its own current stock, plus its live event multiplier — the
    // two gates that separate "wants this eventually" from "could use this right now". A good with
    // no row here reads as unbraked: no row means no stock and no yard, which is not a stopped
    // factory.
    const pinToAnchor = opts.drawBrakeCeiling === "anchor";
    const brakeByGood = new Map<string, number>();
    const multByGood = new Map<string, number>();
    for (const m of row.markets) {
      if (pinToAnchor) {
        brakeByGood.set(
          m.goodId,
          anchorCeiling(m.stock, marketBandForRow(m, GOODS[m.goodId]).targetStock),
        );
      } else {
        const knee = brakeKnee(
          {
            useRate: useRateOf(m),
            capacityProduction: prodByKey.get(m.goodId) ?? 0,
            anchorMult: m.anchorMult,
          },
          ECONOMY_SIM_PARAMS,
        );
        brakeByGood.set(m.goodId, productionCeiling(m.stock, knee));
      }
      multByGood.set(m.goodId, m.productionMult ?? 1);
    }
    drawRates = drawRatesByGood({
      buildings: row.buildings,
      population: row.population,
      yields: row.yields,
      extractionEff: row.extractionEff,
      productionSuppress,
      rates,
      brakeCeilingOf: (goodId) => brakeByGood.get(goodId) ?? 1,
      productionMultOf: (goodId) => multByGood.get(goodId) ?? 1,
    });
  }

  const goods: GoodMarketState[] = [];
  for (const m of row.markets) {
    const civ = consByKey.get(m.goodId) ?? 0;
    const demand = useRateOf(m);
    // An explicit zero is a completed assessment and must remain a sink. Capacity is
    // only a legacy-save fallback while the persisted rate is genuinely absent.
    const production = m.realisedProductionRate ?? (prodByKey.get(m.goodId) ?? 0);
    // The role decides both lines, the margin-free flag and the deep line the founding cap reads.
    const lines = logisticsLinesFor(
      {
        demand,
        production,
        productionSuppressed: m.productionSuppressed,
        realisedUse: m.realisedUse,
        steadyInbound: m.steadyInbound,
        lateInboundShare: m.lateInboundShare,
        supplierShortRuns: m.supplierShortRuns,
        anchorMult: m.anchorMult,
      },
      stockpileScale,
    );
    goods.push({
      goodId: m.goodId,
      stock: m.stock,
      logisticsTarget: lines.logisticsTarget,
      donorReserve: lines.donorReserve,
      demand,
      // A good with no draw entry keeps its standing want as its urgency rather than sinking to
      // the back of the import queue; callers that never read urgency get the same fallback.
      drawDemand: drawRates?.get(m.goodId) ?? demand,
      civilianDemand: civ,
      production,
      capacityProduction: prodByKey.get(m.goodId) ?? 0,
      satisfaction: m.satisfaction,
      productionSuppressed: m.productionSuppressed,
      squeezeCycles: m.squeezeCycles,
      proposalCycles: m.proposalCycles,
      logisticsFundingBound: m.logisticsFundingBound,
      scheduledInbound: opts.scheduledInboundFor?.(m.goodId),
      // Straight pass-through — absent on the row must stay absent here, never read as 0 (an unknown
      // rolling rate is not the same claim as a measured zero).
      realisedUse: m.realisedUse,
      steadyInbound: m.steadyInbound,
      lateInboundShare: m.lateInboundShare,
      role: lines.role,
      marginFree: lines.marginFree,
      consumerDeepLine: lines.consumerDeepLine,
    });
  }
  return goods;
}
