/**
 * Pure directed-logistics matching — zero DB dependency. The processor computes
 * per-system supply/demand/band numbers (reusing capacityGoodRates / inputDemandForGood /
 * marketBandForRow) and a route-cost function; this engine just classifies and matches.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { GOOD_NECESSITY } from "@/lib/constants/physical-economy";
import { raiseFor, solveWaterLevel, type LevelWorld } from "./shelf-levelling";
import type { RouteBlocked, RouteBookerFor } from "./lane-routing";

// Re-exported so existing callers (the processor, tests) keep importing the matcher's booker view
// from here — the type itself now lives beside `RouteBooker` in `lane-routing.ts` (no runtime
// import cycle between the booker and the matcher).
export type { RouteBookerFor };

export type MarketKind = "deficit" | "surplus" | "balanced";

export interface MarketClassification {
  kind: MarketKind;
  /** target − stock when deficit (> 0); else 0. */
  shortfall: number;
  /** stock − target when surplus (> 0); else 0 — never draws below the target. */
  drawable: number;
}

/**
 * Classify one good's market against a cycles-of-supply target. Deficit ⇔
 * stock < target × DEFICIT_FRACTION; surplus ⇔ stock ≥ target ×
 * SURPLUS_MARGIN; the dead-band between is balanced.
 *
 * The matcher passes `logisticsTarget` — cycles of the system's REAL demand. It must not be
 * handed the pricing anchor (`targetStock`), whose denominator floors at `MIN_DEMAND`: a market
 * whose real demand sits under that floor would then request a target set by a divide-by-zero
 * guard rather than by anything anyone there consumes.
 *
 * A target of 0 means nobody here wants the good, so the market is never a sink. That is the intended
 * exit for a genuinely inert market, and it is why the caller must supply a demand-derived target
 * rather than a floored one — under the floor, no market could ever reach it. It says nothing about
 * the source side: `surplusDrawable` decides that separately, and a market with no local demand is
 * fully drawable there.
 *
 * `stock` is whatever the caller passes, not necessarily physical stock — the matcher's sink test
 * feeds `stock + scheduledInbound` here (`docs/active/gameplay/logistics-lanes.md` §2/§3: a system with
 * enough goods in flight to clear the deficit line is not a deficit, the oscillation guard the
 * premise-3 falsification demands) while the donor test and every other reader
 * (`market-analysis.ts`, `computeCoverLevels`) keep passing physical stock alone, deliberately —
 * see `GoodMarketState.scheduledInbound`'s docstring. This function itself has no opinion on which;
 * it only classifies whatever number it is handed.
 */
export function classifyMarketState(stock: number, target: number): MarketClassification {
  // No demand ⇒ no cycles-of-supply target — never a sink, never a drawable surplus; treat as balanced.
  if (target <= 0) {
    return { kind: "balanced", shortfall: 0, drawable: 0 };
  }
  if (stock < target * DIRECTED_LOGISTICS.DEFICIT_FRACTION) {
    return { kind: "deficit", shortfall: Math.max(0, target - stock), drawable: 0 };
  }
  if (stock >= target * DIRECTED_LOGISTICS.SURPLUS_MARGIN) {
    return { kind: "surplus", shortfall: 0, drawable: Math.max(0, stock - target) };
  }
  return { kind: "balanced", shortfall: 0, drawable: 0 };
}

/**
 * Drawable directed-logistics surplus for one (system, good). A structural exporter
 * (production > demand) may ship down to EXPORT_RESERVE_COVER cycles of its own demand; every other
 * donor must clear SURPLUS_MARGIN and stops at `donorReserve`, DONOR_RESERVE_COVER cycles of its own
 * real demand. Realised production keeps suppressed or input-starved former exporters on the
 * ordinary-donor path.
 * One definition, shared by the logistics matcher and the build planner so both read
 * "surplus" alike.
 *
 * The exporter's reserve is denominated in cycles of demand, not as a fraction of `targetStock`: the
 * anchor is a price-curve reference (TARGET_COVER = 40 cycles), and borrowing it as a shipping
 * threshold set the bar at 30 cycles — which a producer built to demand + PROVISION_MARGIN reaches
 * only to be drained straight back to it, so it exported its thin margin and nothing more.
 *
 * The ordinary donor's floor is demand-denominated for the same reason, and both sides of the match
 * are: the deficit test fills to `logisticsTarget`, the donor stops at `donorReserve`, and nothing
 * in this function reads the `MIN_DEMAND`-floored price anchor — which on a small market states a
 * divide-by-zero guard on *pricing* rather than anything anyone there consumes. Moving this side was
 * measured end to end first: equilibrium is unchanged on every tracked good (consumer cover matches
 * baseline at 16,000 ticks, galaxy production −0.3%). The accepted cost is transient — stock the
 * price anchor used to over-shelter on small markets now feeds the front of the import queue, so
 * during the scarcity era consumer shelves fill roughly 1,000-2,000 ticks later. The
 * consumer-cover "collapse" once read off a 10,000-tick A/B was a horizon artifact: that horizon
 * sits inside the transient for high-tier consumer cover, which is why any A/B of it is taken at
 * 12,000+ or as a trajectory.
 *
 * At `demand === 0` the reserve is 0, the SURPLUS_MARGIN test is vacuous and the market's entire
 * stock is drawable. Deliberate: there is no local consumption to hold stock for, and it mirrors
 * what the exporter branch already does at demand 0.
 *
 * `productionSuppressed` here is NOT the same test the build planner's structural
 * assessment makes, and the two must not be collapsed into one. This is a DRAWDOWN
 * decision — may we treat this system as a free-flowing exporter and ship it down past
 * its reserve? — and a struck producer is correctly refused, because the output backing
 * that reserve has stopped arriving. The planner asks a BUILD question — does a strike
 * explain this shortfall, so that building more capacity would be the wrong answer? —
 * which is only ever true where the system already holds capacity in the good.
 */
export function surplusDrawable(
  stock: number,
  donorReserve: number,
  demand: number,
  production: number,
  productionSuppressed = false,
): number {
  const exporterReserve = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * Math.max(0, demand);
  if (production > demand && !productionSuppressed) return Math.max(0, stock - exporterReserve);

  const aboveReserve = stock - donorReserve;
  if (aboveReserve <= 0) return 0;
  const clearsMargin = stock >= donorReserve * DIRECTED_LOGISTICS.SURPLUS_MARGIN;
  return clearsMargin ? aboveReserve : 0;
}

/**
 * What a (world, good) is doing with the good, which decides the two lines it trades on:
 * `producer` makes more than it uses, `supplier` is kept topped up by its own part-production or by
 * steady deliveries, `consumer` is eating the good at a rate worth reserving against, and `idle` is
 * a consumer whose realised use has fallen so far that the restart buffer is the larger of its two
 * give-line terms — the refinery sitting on input it is no longer drawing.
 */
export type LogisticsRole = "producer" | "supplier" | "consumer" | "idle";

/** What the role test and the line author read off one market. All rates are units per reference
 *  cycle, denominated exactly as `demand`; an absent rolling rate is UNKNOWN, never 0. */
export interface MarketRoleInputs {
  /** The USE figure `u` — full-rate civilian want plus the gated recipe draw. */
  demand: number;
  production: number;
  productionSuppressed?: boolean;
  /** Rolling realised use `r`; unknown ⇒ the world is read at full rate, today's behaviour. */
  realisedUse?: number;
  /** Rolling steady inbound `i`; unknown ⇒ nothing counted, so only production can carry the test. */
  steadyInbound?: number;
  /** Rolling late-inbound share `l`; unknown blocks the supplier role only where inbound carries it. */
  lateInboundShare?: number;
  /** Consecutive short runs with nothing credited — at `SUPPLIER_DROP_RUNS` the role is gone. */
  supplierShortRuns?: number;
  anchorMult: number;
}

/** The two lines a market trades on, plus what authored them. */
export interface LogisticsLines {
  role: LogisticsRole;
  /** The want (`GoodMarketState.logisticsTarget`). */
  logisticsTarget: number;
  /** The give-down-to line (`GoodMarketState.donorReserve`). */
  donorReserve: number;
  /** Whether the give line is a buffer, which is given down to without clearing `SURPLUS_MARGIN`. */
  marginFree: boolean;
  /** `GoodMarketState.consumerDeepLine` — what a full-rate consumer of this good would keep. */
  consumerDeepLine: number;
}

/** A rolling rate that was actually measured; anything else is unknown and must not read as 0. */
function knownRate(rate: number | undefined): number | undefined {
  return typeof rate === "number" && Number.isFinite(rate) ? rate : undefined;
}

/**
 * Is this world's supply of the good replenished — its own part-production, a steady inbound
 * stream, or the two together covering `SUPPLIER_REPLENISHMENT` of what it uses? Gated on the
 * late-inbound tail ONLY where inbound is load-bearing: a world that clears the bar on production
 * alone has no transit exposure to bound, so an unknown late share cannot deny it the role.
 */
function replenished(m: MarketRoleInputs, use: number): boolean {
  if ((m.supplierShortRuns ?? 0) >= DIRECTED_LOGISTICS.SUPPLIER_DROP_RUNS) return false;
  const inbound = knownRate(m.steadyInbound) ?? 0;
  const bar = DIRECTED_LOGISTICS.SUPPLIER_REPLENISHMENT * use;
  if (m.production + inbound < bar) return false;
  if (m.production >= bar) return true;
  const late = knownRate(m.lateInboundShare);
  return late !== undefined && late <= DIRECTED_LOGISTICS.SUPPLIER_LATE_SHARE;
}

/**
 * The role test, in order: producer, then supplier, then the consumer branch — where a world whose
 * restart buffer is the larger of its two give-line terms is `idle` rather than `consumer`.
 *
 * Lives here rather than at the line-authoring site because the build planner's input gate asks the
 * identical question of the identical inputs ("is this stock a flow or a one-off level?"), and the
 * two answers must never drift apart.
 */
export function classifyLogisticsRole(m: MarketRoleInputs): LogisticsRole {
  const use = Math.max(0, m.demand);
  const producing = m.production > use && !m.productionSuppressed;
  // No local use at all: nothing to reserve against and no test to pass — the world is whatever its
  // own output makes it (`surplusDrawable` already treats its whole stock as drawable).
  if (use <= 0) return producing ? "producer" : "consumer";
  if (producing) return "producer";
  if (replenished(m, use)) return "supplier";
  const realised = knownRate(m.realisedUse) ?? use;
  const buffer = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * use;
  const deep = DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * Math.max(0, realised) * m.anchorMult;
  return buffer >= deep ? "idle" : "consumer";
}

/**
 * The want and the give-down-to line for one market, from its role.
 *
 * A producer and a supplier trade on the same pair — a restart buffer of `EXPORT_RESERVE_COVER`
 * cycles of full-rate use, re-ordering under `SUPPLIER_WANT_COVER` cycles of it — because both are
 * refilled: one by its own output, the other by what is delivered to it. A consumer reserves
 * `DONOR_RESERVE_COVER` cycles of what it ACTUALLY uses and asks back up to `WAREHOUSE_COVER`
 * cycles of the same, never below that buffer, so a world eating the good at full rate keeps
 * exactly the lines it has always kept and a world that has stopped drawing collapses to the
 * buffer.
 *
 * The buffer terms are anchor-immune, as the producer's floor has always been (warehouse policy has
 * no business moving with a price-anchor event); the deep terms ride `anchorMult` as they do today.
 * `stockpileScale` multiplies every line of every role, so the ratios between them — and with them
 * the band invariant — are untouched by it.
 */
export function logisticsLinesFor(m: MarketRoleInputs, stockpileScale: number): LogisticsLines {
  const role = classifyLogisticsRole(m);
  const use = Math.max(0, m.demand);
  if (use <= 0) {
    return { role, logisticsTarget: 0, donorReserve: 0, marginFree: false, consumerDeepLine: 0 };
  }
  const deepAtFullRate =
    DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * use * stockpileScale * m.anchorMult;
  const buffer = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * use * stockpileScale;
  const bufferWant = DIRECTED_LOGISTICS.SUPPLIER_WANT_COVER * use * stockpileScale;
  if (role === "producer" || role === "supplier") {
    return {
      role,
      logisticsTarget: bufferWant,
      donorReserve: buffer,
      marginFree: true,
      consumerDeepLine: deepAtFullRate,
    };
  }
  const realised = Math.max(0, knownRate(m.realisedUse) ?? use);
  const deep = DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * realised * stockpileScale * m.anchorMult;
  const deepWant = DIRECTED_LOGISTICS.WAREHOUSE_COVER * realised * stockpileScale * m.anchorMult;
  return {
    role,
    logisticsTarget: Math.max(bufferWant, deepWant),
    donorReserve: Math.max(buffer, deep),
    marginFree: buffer >= deep,
    consumerDeepLine: deepAtFullRate,
  };
}

/** This system's per-cycle logistics work-budget contribution (free, population-scaled in v1). */
export function systemLogisticsGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_LOGISTICS.GENERATION_PER_POP;
}

export interface GoodMarketState {
  goodId: string;
  stock: number;
  /** Cycles-of-supply WAREHOUSING target — how much of the good this system tries to keep on hand.
   *  Deficit ⇔ stock < logisticsTarget × DEFICIT_FRACTION. Authored from the market's role
   *  (`logisticsLinesFor`): a refilled world asks back to `SUPPLIER_WANT_COVER` cycles of full-rate
   *  use, a consumer to `WAREHOUSE_COVER` cycles of its realised use, never below the former.
   *  Denominated in the system's REAL demand, unfloored, so a market whose demand sits under
   *  `MIN_DEMAND` asks for what it uses rather than what the pricing guard implies. 0 where nothing
   *  here wants the good, which drops the market out of the match as a sink. */
  logisticsTarget: number;
  /** Cycles-of-supply DONOR floor — what this market keeps for itself before it gives anything
   *  away, and the base its SURPLUS_MARGIN test is taken against where `marginFree` is false. Same
   *  role authoring as `logisticsTarget`: a restart buffer of `EXPORT_RESERVE_COVER` cycles of
   *  full-rate use for a refilled world, `DONOR_RESERVE_COVER` cycles of realised use for a
   *  consumer, never below that buffer. 0 where nothing here wants the good, which makes the whole
   *  stock drawable — see `surplusDrawable`. */
  donorReserve: number;
  /** The USE figure: what this system's population and industry draw when running — civilian want at
   *  full rate plus the staffing- and strike-gated recipe draw. Every warehousing quantity above is
   *  denominated in it, as is the self-supply gate (vs production), because a classification that
   *  flipped with a one-cycle brake flicker is worse than none. Never the urgency weight. */
  demand: number;
  /** The DRAW figure: `demand` further gated by each consuming factory's own output brake at its
   *  current stock and its live event production multiplier — how urgently a delivery is needed
   *  RIGHT NOW, as opposed to how much this world uses in the long run. Its only reader is the
   *  ordering cover (`orderCover`) that decides which shelf is served first; nothing that sizes or
   *  reserves stock may touch it — the level and every raise stay denominated in `demand`, so a cycle
   *  is one unit across every world regardless of how braked any of them are right now. */
  drawDemand: number;
  /** The civilian half of `demand` alone (per-capita baseline + skilled baskets, no industrial input
   *  draw). The housing fed-gate folds this: necessity is authored on the civilian axis, so weighting
   *  a refinery's ore draw with it would collapse D however starved its factories are. */
  civilianDemand: number;
  /** Realised production rate from the last economy assessment. A system that self-supplies (production >= demand) is never a deficit sink. */
  production: number;
  /** Current building capacity, retained separately for construction target sizing. */
  capacityProduction: number;
  /** Persisted consumption satisfaction from the last economy cycle (missing ⇒ 1) — the build planner's fed-proxy input; the matcher itself does not read it. */
  satisfaction?: number;
  /** Strike or maintenance reduced actual output; event modifiers deliberately do not set this. */
  productionSuppressed?: boolean;
  /** Reference-cycles a rationed economy assessment has persisted — a finite value in [0,2] advanced per
   *  assessment by the economy interval's catchUpFactor. */
  squeezeCycles?: number;
  /** Reference-cycles a structural construction assessment has persisted — a finite value in [0,2]
   *  advanced per assessment by the construction interval's catchUpFactor. */
  proposalCycles?: number;
  /** A reachable logistics match was constrained by the faction's funded haul work. */
  logisticsFundingBound?: boolean;
  /** Goods already dispatched toward this system for this good, not yet arrived — the outbound leg
   *  of the pending-arrivals ledger (`scheduledInbound`, `lib/engine/freight.ts`). Absent ⇒ 0. Read
   *  by the sink test only, as `stock + scheduledInbound` against `logisticsTarget`
   *  (`docs/active/gameplay/logistics-lanes.md` §3, "Deficit classification counts inbound") — the donor
   *  test and every other reader of this good's stock stay on physical stock alone, so a shipment
   *  in flight is counted exactly once and a world still lacking goods still reads as needing them
   *  for welfare purposes. */
  scheduledInbound?: number;
  /** Rolling realised-use rate — see `WorldMarket.realisedUse`. Absent ⇒ unknown, never 0. Threaded
   *  through so the read path carries it end to end to the role classification. */
  realisedUse?: number;
  /** Rolling steady-inbound rate — see `WorldMarket.steadyInbound`. Absent ⇒ unknown, never 0. Read
   *  by the planner's input gate so a supplier's flow, not just a producer's, licenses a
   *  factory downstream. */
  steadyInbound?: number;
  /** Rolling late-inbound share — see `WorldMarket.lateInboundShare`. Absent ⇒ unknown, never 0. */
  lateInboundShare?: number;
  /** What this world is doing with this good, and so which pair of lines above it trades on — see
   *  `classifyLogisticsRole`, which authors both from the same inputs. */
  role: LogisticsRole;
  /**
   * Whether this market's give-line for this good is the restart buffer rather than the deep
   * reserve `surplusDrawable`'s ordinary-donor branch clears `SURPLUS_MARGIN` above before it
   * donates — the margin-free flag `surplusDrawable` reads at every call site. A world holding the
   * buffer gives everything above it; a world holding the deep reserve gives only what clears
   * 1.4× it.
   */
  marginFree: boolean;
  /**
   * The deep line a full-rate consumer of this good would keep — `DONOR_RESERVE_COVER × demand ×
   * anchorMult × stockpileScale` — read by the founding staging cap regardless of this market's own
   * role, so a colony never draws a relay or idle world below what a consumer would have held. It
   * coincides with `donorReserve` only for a full-rate consumer; for every other role the give line
   * is its own.
   */
  consumerDeepLine: number;
}

/**
 * Physical stock plus what is already in flight toward this market, except: while physical `stock`
 * sits under `RATION_COVER` cycles of `demand` — the use-figure proxy of the economy's ration line
 * (`ECONOMY_CONSTANTS.RATION_COVER`, `lib/constants/economy.ts`) — inbound is dropped and only the
 * physical figure counts. Against a level of a few cycles, a haul in transit (~17 ticks per lane) can
 * be the whole level while the shelf itself is empty, so a market this thin is read on what is
 * actually on the shelf. The boundary is strict-below: a market exactly on the line already counts
 * inbound. Above the line, behaves exactly as the sink test's `stock + scheduledInbound` does today.
 */
export function countedStock(g: GoodMarketState): number {
  const rationLine = ECONOMY_CONSTANTS.RATION_COVER * g.demand;
  if (g.stock < rationLine) return g.stock;
  return g.stock + (g.scheduledInbound ?? 0);
}

/**
 * Cycles of cover against the DRAW figure — how close a market is to running dry at its current,
 * possibly-braked draw rate. The ordering term only: never used to size a raise (`drawDemand`'s own
 * docstring forbids that). Reads +Infinity at `drawDemand` 0 rather than dividing by zero, so a
 * fully-braked market with no live want sorts last in an ascending-cover queue instead of producing
 * `NaN`. A braked factory (`drawDemand` below `demand`) therefore reads a HIGHER `orderCover` than an
 * unbraked market at the same stock and use — it is not drawing urgently right now, whatever its
 * warehouse level says.
 */
export function orderCover(g: GoodMarketState): number {
  if (g.drawDemand <= 0) return Infinity;
  return countedStock(g) / g.drawDemand;
}

/**
 * Cycles of cover against the USE figure — the unit every warehousing quantity and every raise is
 * denominated in (`GoodMarketState.demand`'s own docstring). Only ever called on a deficit, where
 * `logisticsTarget > 0` and so `demand > 0` (`classifyMarketState`'s target-0 guard keeps a market
 * with no demand out of the deficit list entirely) — never a division by zero in practice.
 */
export function levelCover(g: GoodMarketState): number {
  return countedStock(g) / g.demand;
}

/**
 * The goods of one run in the order a faction serves them: descending `GOOD_NECESSITY` — how much
 * not having the good counts as suffering — with ties broken by ascending good id, so the order is
 * total and identical on every save. Only the rank is read, never the magnitude. A good absent from
 * the table reads 0 and sorts last, never first.
 *
 * The haul budget and lane capacity are shared across a faction's whole run, so this ordering is
 * what "food before luxuries" means mechanically: when either binds, it binds on the least
 * necessary good first.
 */
export function goodsInNecessityOrder(goodIds: Iterable<string>): string[] {
  return [...goodIds].sort((a, b) => {
    const byNecessity = (GOOD_NECESSITY[b] ?? 0) - (GOOD_NECESSITY[a] ?? 0);
    if (byNecessity !== 0) return byNecessity;
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
}

export interface SystemLogisticsState {
  systemId: string;
  factionId: string | null;
  generation: number;
  goods: GoodMarketState[];
}

/**
 * One booked placement of a draw. A haul the booker splits across multiple paths under congestion
 * yields several `PlannedTransfer` rows for the same donor→sink draw, one per placement, whose
 * quantities sum to what was actually placed — never the whole draw when part of it was blocked
 * (`docs/active/gameplay/logistics-lanes.md` §2).
 */
export interface PlannedTransfer {
  goodId: string;
  fromSystemId: string;
  toSystemId: string;
  quantity: number;
  cost: number;
  /** Lane keys crossed by this placement, in path order — `RoutePlacement.edges`. */
  edges: string[];
  /** This placement's summed raw (unweighted) fuel cost — `RoutePlacement.fuelTotal`. */
  fuelTotal: number;
}

/** One deficit the budget left materially short. With donors filling a deficit in turn,
 *  `fromSystemId` names the donor whose draw the budget stopped — NOT the only donor tried;
 *  cheaper donors may already have shipped in full and are not named. The processor flags
 *  both endpoints' markets `logisticsFundingBound` off this row. */
export interface FundingBoundMatch {
  goodId: string;
  fromSystemId: string;
  toSystemId: string;
}

/**
 * One deficit no reachable same-faction donor — at the drawable capacity each still holds once this
 * good's whole pass is done, summed across every reachable donor — could close, even given
 * unlimited haul budget. The LIVE capacity, not each donor's pre-run figure: what the run already
 * moved is gone, and a faction whose demand for a good exceeds its supply of it really cannot serve
 * everyone. Reading the pre-run figures instead would let a system that received nothing, with no
 * capacity for it anywhere in the faction, report no problem at all. Local production is not
 * restated here: every entry in the deficit queue already failed the self-supply gate
 * (`production < demand`), so "no local production can close it" already holds for anything that
 * reaches this test.
 *
 * Read at the end of the pass, EVERY world the faction's supply left short carries its own share of
 * the gap, and the levels sum to exactly the tonnage the faction lacks.
 *
 * Independent of `FundingBoundMatch`, which records the budget stopping a fill that had enough
 * reachable capacity to succeed. The two are decided from different quantities (summed reachable
 * `drawable` vs. the budget-stopped donor's own draw) and are not mutually exclusive: a deficit whose
 * reachable donors are jointly too small AND whose fill also hits the budget wall before exhausting
 * them carries both. The processor records the deficit endpoint only — donors never appear here,
 * unlike `FundingBoundMatch`, which names both ends of the haul it describes.
 */
export interface UnservableDeficit {
  goodId: string;
  systemId: string;
  /** The part of the deficit's want that no reachable donor capacity covers — what it still wants
   *  when the good's pass ends (`target − stock − scheduledInbound`, less everything it drew this
   *  run) minus the reachable drawable this test summed, strictly positive by the test that emits
   *  the entry. NOT the whole want: a deficit wanting 50 that draws 20 and can source no more
   *  reports 30, which is exactly what it ends up missing.
   *  A CAPACITY measure throughout — computed from what exists, never from how far the
   *  budget-limited spending loop got, which is `FundingBoundMatch`'s question. */
  shortfall: number;
}

export interface TransferMatchResult {
  transfers: PlannedTransfer[];
  fundingBound: FundingBoundMatch[];
  unservable: UnservableDeficit[];
  /** Deficits whose fill ended early because a draw was unaffordable — the per-deficit skip
   *  (`docs/active/gameplay/logistics-lanes.md` §2) that replaced the old run-terminating budget clamp.
   *  Counts deficits, not draws: a deficit with several donors contributes at most 1, at the donor
   *  whose draw the budget stopped. Independent of `fundingBound`, which additionally requires the
   *  residual left standing to be material (`FUNDING_BOUND_RESIDUAL_FRACTION`). */
  budgetSkipped: number;
  /** Every `RouteBooker.routeAndBook` blocked entry this faction's fan-out produced this cycle —
   *  the congestion the booker itself recorded on a lane, surfaced here (rather than discarded, as
   *  before) purely as calibration instrumentation for the harness's `contentionShortfallByFaction`
   *  reading. Not consumed by any decision in this function. */
  blocked: RouteBlocked[];
}

/**
 * One (system, good) this run is filling. The two cover readings are the levelling's whole state:
 * `orderCover` is frozen at classification and fixes the draw order, `levelCover` rises in place as
 * the world draws so a later turn tops it up to a recomputed level instead of re-drawing what it
 * already holds.
 */
interface Deficit {
  systemId: string;
  goodId: string;
  /** The full want to the warehousing target at classification time
   *  (`logisticsTarget − stock − scheduledInbound`). Only feeds `unservable`'s figure where this good
   *  has no reachable donor at all — `unservable`'s general numerator is `remainingCap`, and
   *  `fundingBound`'s materiality base is `stoppedWant`. Never the size of a draw. */
  shortfall: number;
  /** The owning system's position in the input array — the draw order's tie-break. */
  systemOrder: number;
  /** Cycles of cover against the DRAW figure. Only ever a sort key: `Infinity` (nothing drawing
   *  here right now) sorts last and never enters any arithmetic. */
  orderCover: number;
  /** Cycles of cover against the USE figure — the unit the water level and every raise are
   *  measured in. */
  levelCover: number;
  /** The cover this world stops wanting more at (`logisticsTarget ÷ demand`). */
  targetCover: number;
  /** Units per cycle. 0 for a market with no demand, which can never want anything. */
  demand: number;
  /** What this world can still take this run: its shortfall less everything drawn so far. Also the
   *  remaining want the structural reading is taken against once the good's pass is done. */
  remainingCap: number;
  /** The donor whose draw the budget stopped on this world's most recent turn, if any. */
  stoppedDonorId: string | null;
  /** What that stop left standing of the raise it stopped. */
  stoppedResidual: number;
  /** The whole raise that stop ended — the materiality denominator `stoppedResidual` is judged
   *  against. A world stopped on a later top-up turn is judged against THAT turn's raise, not
   *  against the first one and not against its full want to the warehousing target. */
  stoppedWant: number;
  /** Already counted in `budgetSkipped` — a deficit contributes at most 1 however many turns it
   *  takes. */
  budgetCounted: boolean;
}
interface Surplus {
  systemId: string;
  goodId: string;
  /** Spent down in place as deficits draw on this donor — the live remainder. */
  drawable: number;
  order: number;
}

/** Emptiest shelf first, ties broken by the owning system's position in the input array. Written as
 *  a comparison rather than a subtraction because two worlds with nothing drawing right now both
 *  read `Infinity`, and `Infinity - Infinity` is `NaN`. */
function byDrawOrder(a: Deficit, b: Deficit): number {
  if (a.orderCover !== b.orderCover) return a.orderCover < b.orderCover ? -1 : 1;
  return a.systemOrder - b.systemOrder;
}

/** This deficit as the solver sees it — cycles of cover, plus the units-per-cycle a cycle is worth. */
function levelWorldOf(d: Deficit): LevelWorld {
  return { id: d.systemId, levelCover: d.levelCover, targetCover: d.targetCover, demand: d.demand };
}

/**
 * Surplus→deficit matching for ONE faction's systems (or all independents), levelling the shelves
 * within each good. Budget = Σ system.generation, spent as the summed priced cost of what
 * `booker.routeAndBook` actually places, shared across every good this run. Goods are served in
 * necessity order (`goodsInNecessityOrder`), so when the shared budget or a lane binds, it binds on
 * the least necessary good first.
 *
 * Per good: the faction's reachable supply — the live drawable of every donor at least one of that
 * good's deficits can reach (`reachableFrom`, saturation-blind) — sets a **water level** `L` in
 * cycles of each world's own use figure (`solveWaterLevel`). Every deficit below `L` is raised to it,
 * or to its own warehousing target if that is lower; every deficit already above it draws nothing.
 * When the supply covers every deficit's target, `L` is that target and the whole queue fills, which
 * is what an ample-supply run has always done.
 *
 * Draws are placed in ascending `orderCover` — emptiest shelf first, measured against the DRAW
 * figure, so it is congestion and the budget that bite the comfortable worlds rather than the
 * starving ones. Each deficit draws its raise from every same-faction donor holding drawable
 * surplus, in ascending `priceFrom`-order (frozen for that turn's whole fan-out), until the raise is
 * met, donors are exhausted, or an unaffordable draw ends this deficit's turn — the **per-deficit
 * skip** that replaces the old run-terminating budget clamp
 * (`docs/active/gameplay/logistics-lanes.md` §2): the remaining budget carries forward rather than
 * zeroing for the whole run, so one dear draw no longer starves every deficit behind it.
 *
 * The level is a **fixed point, not a single pass**. Where a world's own donors cannot meet its
 * raise, its level is fixed where it stopped, it leaves the levelling, and `L` is recomputed over
 * the worlds still in it against the supply they can still reach; the worlds already drawn are then
 * topped up to the new level, so a world drawn early never ends below one drawn later. Each
 * recomputation removes a world, so the loop terminates. A budget stop is not such an event — it is
 * money, not capacity — so it ends that world's turn and leaves it in the levelling.
 *
 * A haul the booker splits across multiple paths under congestion yields one `PlannedTransfer` per
 * placement, its quantities summing to what the booker actually placed — the unplaced remainder is
 * congestion, which the booker itself records as blocked volume, and is neither drawn from the
 * donor, billed, nor treated as unservable or funding-bound here.
 */
export function matchFactionTransfers(
  systems: SystemLogisticsState[],
  booker: RouteBookerFor,
): TransferMatchResult {
  let budget = 0;
  for (const s of systems) budget += s.generation;

  // Classify each (system, good) as deficit or surplus. Mutable drawable/cover as we allocate.
  // Deficits are grouped by good because the level is solved within a good; the goods themselves are
  // then walked in necessity order (`goodsInNecessityOrder`), so the shared budget and the shared
  // lane capacity bind on the least necessary good first.
  const deficitsByGood = new Map<string, Deficit[]>();
  const surplusesByGood = new Map<string, Map<string, Surplus>>();

  for (let systemOrder = 0; systemOrder < systems.length; systemOrder++) {
    const s = systems[systemOrder];
    for (const g of s.goods) {
      // Sink test: stock plus what is already in flight toward this good, so a delivery already
      // dispatched does not order a second one (docs/active/gameplay/logistics-lanes.md §3). The donor
      // test below stays on physical stock alone.
      const c = classifyMarketState(g.stock + (g.scheduledInbound ?? 0), g.logisticsTarget);
      // Self-supply gate: a system that produces at least its own demand is never a deficit
      // sink for that good (it refills from its own output), even when standing stock dips below
      // the warehousing target. Without this, high-throughput producers — which hold little
      // inventory relative to their demand rate — read as deficits and get shipped a good they
      // already make, piling stock to the ceiling and decaying their own producers.
      if (c.kind === "deficit" && c.shortfall > 0 && g.production < g.demand) {
        let list = deficitsByGood.get(g.goodId);
        if (!list) {
          list = [];
          deficitsByGood.set(g.goodId, list);
        }
        // A deficit implies a positive warehousing target and so a positive use figure; the guard
        // keeps a fixture that states otherwise out of every division rather than letting an
        // Infinity or a NaN into the solver.
        const uses = g.demand > 0;
        const currentLevelCover = uses ? levelCover(g) : 0;
        list.push({
          systemId: s.systemId,
          goodId: g.goodId,
          shortfall: c.shortfall,
          systemOrder,
          // The draw order reads the DRAW figure: a factory that cannot run right now — its own
          // yard full, or an event holding its rate down — is not close to running out, whatever
          // its warehouse level says, and should not be raised ahead of one idle for want of this
          // very delivery. Membership above and every quantity below stay on the use figure.
          orderCover: orderCover(g),
          levelCover: currentLevelCover,
          // Capped at levelCover + shortfall/demand, not just logisticsTarget/demand: `levelCover`
          // is read off PHYSICAL stock alone once a market sits under the ration line
          // (`countedStock`), while `shortfall` (and so `remainingCap`) is computed against
          // `stock + scheduledInbound`. The two denominators differ by exactly the in-flight
          // quantity for a ration-line world, so `logisticsTarget / demand` alone states a cover
          // this world cannot actually reach — the solver over-states its want, the level lands too
          // low, and pool is left unspent while later worlds in the same pass draw nothing.
          targetCover: uses
            ? Math.min(g.logisticsTarget / g.demand, currentLevelCover + c.shortfall / g.demand)
            : 0,
          demand: uses ? g.demand : 0,
          remainingCap: c.shortfall,
          stoppedDonorId: null,
          stoppedResidual: 0,
          stoppedWant: 0,
          budgetCounted: false,
        });
        continue;
      }
      // Surplus source — standing excess inventory above the donor's own reserve OR a structural
      // producer (see surplusDrawable; the latter is what the production throttle would otherwise suppress).
      const drawable = surplusDrawable(g.stock, g.donorReserve, g.demand, g.production, g.productionSuppressed);
      if (drawable > 0) {
        const bySystem = surplusesByGood.get(g.goodId) ?? new Map<string, Surplus>();
        bySystem.set(s.systemId, {
          systemId: s.systemId,
          goodId: g.goodId,
          drawable,
          order: systemOrder,
        });
        surplusesByGood.set(g.goodId, bySystem);
      }
    }
  }

  const transfers: PlannedTransfer[] = [];
  const fundingBound: FundingBoundMatch[] = [];
  const unservable: UnservableDeficit[] = [];
  const blocked: RouteBlocked[] = [];
  let budgetSkipped = 0;

  /**
   * Draw `want` units into one deficit from every willing donor it can price, cheapest first (tie:
   * stable system order), and return what was actually placed. One or more `PlannedTransfer` rows
   * per donor-draw — the booker may split a single draw across paths under congestion. A single-donor
   * cap here left reachable stock unshipped beside standing deficits (~42% of equilibrium unmet
   * tonnage in the attribution run). A dry donor is excluded: it could only contribute a
   * zero-quantity draw. Candidates require a LIVE priced path (`priceFor`) — congestion may block a
   * donor from shipping this run even though it counts toward the structural reading below.
   *
   * `d.stoppedDonorId` / `d.stoppedResidual` / `d.stoppedWant` are rewritten each turn, so they
   * always describe this world's most recent turn — a world stopped on a later top-up is judged
   * against that turn's raise. `budgetSkipped` counts the world once however many turns it takes.
   */
  function drawRaise(d: Deficit, want: number, sources: ReadonlyMap<string, Surplus>): number {
    // One priced search from this sink, frozen for its whole donor fan-out — a later draw turn
    // re-searches and sees this turn's bookings.
    const priceFor = booker.priceFrom(d.systemId);
    const candidates: Array<{ source: Surplus; perUnit: number }> = [];
    for (const [sourceSystemId, source] of sources) {
      const perUnit = priceFor(sourceSystemId);
      if (perUnit === null) continue;
      if (source.drawable <= 0) continue;
      candidates.push({ source, perUnit });
    }
    candidates.sort(
      (a, b) => a.perUnit - b.perUnit || a.source.order - b.source.order,
    );

    let remaining = want;
    d.stoppedDonorId = null;
    d.stoppedResidual = 0;
    d.stoppedWant = 0;
    for (const { source, perUnit } of candidates) {
      if (remaining <= 0) break;

      // Continuous goods — no quantization to whole units (rounding down loses up to one
      // unit per transfer, negligible at high ECONOMY_SCALE but a large fraction of a small
      // budget at low scale, breaking scale-invariance of budget-bound transfers).
      const wanted = Math.min(remaining, source.drawable);
      const affordable = budget > 0 ? budget / perUnit : 0;
      const quantity = Math.min(wanted, affordable);
      // Set when this candidate's LIVE billing overshoots the FROZEN quote `affordable` was sized
      // against — see the comment below the placement loop. Distinct from `affordable < wanted`
      // (this candidate's own stock/raise-limited share was smaller than what the budget could
      // in principle afford): a draw can be exactly `affordable === wanted` (fully served, nothing
      // left over) and still overshoot once congestion prices later placements above the quote.
      let overshotBudget = false;
      if (Number.isFinite(quantity) && quantity > 0) {
        const booking = booker.routeAndBook(source.systemId, d.systemId, quantity);
        let placedTotal = 0;
        if (booking) {
          blocked.push(...booking.blocked);
          for (const placement of booking.placements) {
            const cost = placement.quantity * placement.perUnit;
            transfers.push({
              goodId: d.goodId,
              fromSystemId: source.systemId,
              toSystemId: d.systemId,
              quantity: placement.quantity,
              cost,
              edges: placement.edges,
              fuelTotal: placement.fuelTotal,
            });
            placedTotal += placement.quantity;
            budget -= cost;
          }
          // `affordable` above was sized against the FROZEN per-turn quote (`budget / perUnit`,
          // `perUnit` from `priceFor`), but each placement above is billed at its own LIVE price
          // (`placement.perUnit`) — and live ≥ frozen by construction: this very draw's earlier
          // placements raise congestion, and a split under congestion can land part of the quantity
          // on a costlier detour. A draw quoted at exactly the remaining budget can therefore charge
          // above it. Left negative, `budget` would make `affordable` 0 for every donor and deficit
          // for the rest of the run (`budget > 0 ? … : 0`) — a run-wide cliff, not the per-deficit
          // binding the skip below implements — so it is floored at 0 here. `overshotBudget` still
          // ends THIS candidate's draw (below): the budget genuinely ran out mid-draw, which
          // `affordable < wanted` alone would not catch.
          if (budget < 0) overshotBudget = true;
          budget = Math.max(0, budget);
        }
        // The booker may place less than `quantity` under congestion (RouteBooking.blocked) — the
        // unplaced part is neither drawn from the donor nor billed, and it is not this function's
        // concern: the booker records it as blocked volume on the lane, not as `unservable` or
        // `fundingBound` (docs/active/gameplay/logistics-lanes.md §2, "capacity-blocked volume is its own
        // signal").
        source.drawable -= placedTotal;
        remaining -= placedTotal;
      }
      // An unaffordable draw, or one that overshot the live budget above, ends THIS deficit's turn:
      // later donors here are unaffordable too, and iterating them would only fan out epsilon-sized
      // transfers from float residue. Unlike the retired run-terminating clamp, the budget itself is
      // left exactly as spent (floored at 0, never negative) — the remaining budget stays available
      // to fund the worlds behind this one, which is the gradual binding §2 wants in place of a
      // single cliff. A money stop is NOT a capacity event: it ends the turn and leaves the world in
      // the levelling, where a donor exhaustion would take it out of it.
      if (affordable < wanted || overshotBudget) {
        d.stoppedDonorId = source.systemId;
        d.stoppedResidual = remaining;
        d.stoppedWant = want;
        if (!d.budgetCounted) {
          budgetSkipped++;
          d.budgetCounted = true;
        }
        break;
      }
    }
    return want - remaining;
  }

  // One saturation-blind search per sink SYSTEM for the whole run, shared by every good that system
  // is short of — reachability is traversability alone (`RouteBookerFor.reachableFrom`), so it
  // neither varies by good nor moves with this run's bookings. Built on first use.
  const searches = new Map<string, (donorId: string) => boolean>();
  const canReach = (d: Deficit, donorId: string): boolean => {
    let search = searches.get(d.systemId);
    if (!search) {
      search = booker.reachableFrom(d.systemId);
      searches.set(d.systemId, search);
    }
    return search(donorId);
  };

  for (const goodId of goodsInNecessityOrder(deficitsByGood.keys())) {
    const worlds = deficitsByGood.get(goodId);
    if (!worlds) continue; // unreachable: the order is taken from this very map's keys
    const sources = surplusesByGood.get(goodId);
    if (!sources) {
      // No system anywhere in this faction currently holds surplus of this good at all — the
      // deficit list already guarantees no local production can close it (self-supply gate above),
      // so this is the plainest structural case: no reachable donor, full stop. Reachable capacity
      // is 0 and nothing is drawn, so the level is the whole want — the same "remaining want less
      // the drawable its reachable donors still hold" the end-of-pass test computes below, with
      // nothing to subtract.
      for (const d of worlds) {
        unservable.push({ goodId, systemId: d.systemId, shortfall: d.shortfall });
      }
      continue;
    }

    // The pool that sets the level has to know which donors each world can reach before any of
    // them draws — `canReach` above, saturation-blind. Reachability is `reachableFrom`, NOT
    // `priceFrom`: a donor whose only path is currently saturated still exists, and congestion is
    // not the same as "does not exist" (`docs/active/gameplay/logistics-lanes.md` §2, "a blocked
    // haul is not an unservable one").
    const reachableDrawableFor = (d: Deficit): number => {
      let total = 0;
      for (const [donorId, source] of sources) if (canReach(d, donorId)) total += source.drawable;
      return total;
    };

    const drawOrder = [...worlds].sort(byDrawOrder);
    const levelling = [...drawOrder];

    while (levelling.length > 0) {
      // The pool: every donor at least one world still in the levelling can reach, at the capacity
      // it still holds. A donor only a saturated path reaches counts here — the supply exists,
      // whether or not congestion lets anything cross this run.
      let pool = 0;
      for (const [donorId, source] of sources) {
        if (source.drawable <= 0) continue;
        if (levelling.some((d) => canReach(d, donorId))) pool += source.drawable;
      }
      const level = solveWaterLevel(levelling.map(levelWorldOf), pool);

      let exhausted = -1;
      for (let i = 0; i < levelling.length; i++) {
        const d = levelling[i];
        // A level at or above this world's own target is a full fill: it is sized off the sink
        // test's own shortfall rather than the cover round-trip, so an ample-supply run places
        // exactly the quantity it classified, free of float residue. A `demand <= 0` world's
        // `targetCover` is 0, which this comparison alone would misread as "level already clears
        // it" and hand it a full `remainingCap` — so it is excluded here too, wanting nothing, the
        // same "contributes nothing" `shelf-levelling.ts` states for it. Unreachable on the live
        // path (a deficit implies positive demand); kept for a fixture that states otherwise.
        const want = d.demand <= 0 ? 0 : level >= d.targetCover
          ? d.remainingCap
          : Math.min(raiseFor(levelWorldOf(d), level), d.remainingCap);
        if (want <= 0) continue;

        const placed = drawRaise(d, want, sources);
        if (d.demand > 0) d.levelCover += placed / d.demand;
        d.remainingCap -= placed;

        // Its own donors could not meet its raise, and money is not why: its level is fixed where it
        // stopped and it leaves the levelling, so the level is recomputed for the rest against what
        // they can still reach — and the worlds already drawn are topped up to it on the next round.
        if (d.stoppedDonorId === null && placed < want) {
          exhausted = i;
          break;
        }
      }
      if (exhausted < 0) break;
      levelling.splice(exhausted, 1);
    }

    for (const d of drawOrder) {
      // Funding-bound is a gameplay gate (planner suppression, idle-decay exemption), so it records
      // "this shortfall persists because of money" — a budget-stopped draw alone is not enough when
      // the donors before it already met the raise to within the materiality line. The residual is
      // measured against the RAISE that stop ended, not against the whole want to the warehousing
      // target: a world being raised three cycles is not almost-served merely because the target it
      // is ultimately filling toward is forty.
      if (
        d.stoppedDonorId !== null
        && d.stoppedResidual > d.stoppedWant * DIRECTED_LOGISTICS.FUNDING_BOUND_RESIDUAL_FRACTION
      ) {
        fundingBound.push({
          goodId,
          fromSystemId: d.stoppedDonorId,
          toSystemId: d.systemId,
        });
      }

      // Structural, read once the whole of this good's pass is done: what this world still wants,
      // less the drawable its reachable donors are still holding. Under a real shortage that
      // remainder is spent, so every world left short carries its share and the levels sum to the
      // tonnage the faction lacks. Where its donors DO still hold stock, something other than
      // capacity stopped the haul — money or congestion — and this reading stays silent; those are
      // `fundingBound`'s question and the booker's blocked volume respectively.
      const level = d.remainingCap - reachableDrawableFor(d);
      if (level > 0) {
        unservable.push({ goodId, systemId: d.systemId, shortfall: level });
      }
    }
  }

  return { transfers, fundingBound, unservable, budgetSkipped, blocked };
}
