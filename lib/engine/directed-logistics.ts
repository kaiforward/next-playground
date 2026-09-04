/**
 * Pure directed-logistics matching — zero DB dependency. The processor computes
 * per-system supply/demand/band numbers (reusing capacityGoodRates / inputDemandForGood /
 * marketBandForRow) and a route-cost function; this engine just classifies and matches.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { RouteBlocked, RouteBooking } from "./lane-routing";

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
 * feeds `stock + scheduledInbound` here (`docs/planned/logistics-lanes.md` §2/§3: a system with
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
 * price anchor used to over-shelter on small markets now feeds the front of the severity queue, so
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

/** This system's per-cycle logistics work-budget contribution (free, population-scaled in v1). */
export function systemLogisticsGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_LOGISTICS.GENERATION_PER_POP;
}

export interface GoodMarketState {
  goodId: string;
  stock: number;
  /** Cycles-of-supply WAREHOUSING target (WAREHOUSE_COVER × demand × anchorMult) — how much of the
   *  good this system tries to keep on hand. Deficit ⇔ stock < logisticsTarget × DEFICIT_FRACTION.
   *  Denominated in the system's REAL demand, unfloored, so a market whose demand sits under
   *  `MIN_DEMAND` asks for what it uses rather than what the pricing guard implies. 0 where nothing
   *  here wants the good, which drops the market out of the match as a sink. */
  logisticsTarget: number;
  /** Cycles-of-supply DONOR floor (DONOR_RESERVE_COVER × demand × anchorMult) — what an ordinary
   *  (non-exporter) donor keeps for itself, and the base its SURPLUS_MARGIN test is taken against.
   *  Same denominator and the same `anchorMult` ride as `logisticsTarget`, so the floor a donor stops
   *  at and the target the deficit side fills to move together. 0 where nothing here wants the good,
   *  which makes the whole stock drawable — see `surplusDrawable`. */
  donorReserve: number;
  /** The USE figure: what this system's population and industry draw when running — civilian want at
   *  full rate plus the staffing- and strike-gated recipe draw. Every warehousing quantity above is
   *  denominated in it, as is the self-supply gate (vs production), because a classification that
   *  flipped with a one-cycle brake flicker is worse than none. Never the urgency weight. */
  demand: number;
  /** The DRAW figure: `demand` further gated by each consuming factory's own output brake at its
   *  current stock and its live event production multiplier — how urgently a delivery is needed
   *  RIGHT NOW, as opposed to how much this world uses in the long run. Its only reader is the
   *  matcher's severity weight; nothing that sizes or reserves stock may touch it. */
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
   *  (`docs/planned/logistics-lanes.md` §3, "Deficit classification counts inbound") — the donor
   *  test and every other reader of this good's stock stay on physical stock alone, so a shipment
   *  in flight is counted exactly once and a world still lacking goods still reads as needing them
   *  for welfare purposes. */
  scheduledInbound?: number;
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
 * (`docs/planned/logistics-lanes.md` §2).
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
 * One deficit no reachable same-faction donor — at the drawable capacity each still holds when the
 * queue reaches this deficit, summed across every reachable donor — could close, even given
 * unlimited haul budget. The LIVE capacity, not each donor's pre-run figure: what earlier deficits
 * already took is gone, and a faction whose demand for a good exceeds its supply of it really
 * cannot serve everyone. Reading the pre-run figures instead would let a system that received
 * nothing, with no capacity for it anywhere in the faction, report no problem at all. Local
 * production is not restated here: every entry in the deficit queue already failed the self-supply
 * gate (`production < demand`), so "no local production can close it" already holds for anything
 * that reaches this test.
 *
 * The queue's own worst-first order therefore decides WHICH deficits carry the reading when supply
 * is short — the severest draw first and the rest are left with the gap — but not how big the gap
 * is: the levels below sum to exactly the tonnage the faction lacks.
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
  /** The part of the deficit's want that no reachable donor capacity covers — `Deficit.shortfall`
   *  (`target − stock` at classification time) minus the reachable drawable this test summed,
   *  strictly positive by the test that emits the entry. NOT the whole want: a deficit wanting 50
   *  that draws 20 and can source no more reports 30, which is exactly what it ends up missing.
   *  A CAPACITY measure throughout — computed from what exists, never from how far the
   *  budget-limited spending loop got, which is `FundingBoundMatch`'s question. */
  shortfall: number;
}

export interface TransferMatchResult {
  transfers: PlannedTransfer[];
  fundingBound: FundingBoundMatch[];
  unservable: UnservableDeficit[];
  /** Deficits whose fill ended early because a draw was unaffordable — the per-deficit skip
   *  (`docs/planned/logistics-lanes.md` §2) that replaced the old run-terminating budget clamp.
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
 * The matcher's view of a `RouteBooker` (`lib/engine/lane-routing.ts`) — a structural subset any
 * real booker satisfies and a test can hand-roll without constructing a lane network. `priceFrom`
 * freezes one sink's prices to every donor for that deficit's whole fan-out (`docs/planned/
 * logistics-lanes.md` §2: "prices are frozen at the moment the severity queue reaches that
 * deficit"); `routeAndBook` is consulted inside the fill loop with the quantity being drawn, and
 * places it onto the shared network, so a later deficit's `priceFrom` reflects prior bookings.
 */
export interface RouteBookerFor {
  priceFrom(sinkId: string): (donorId: string) => number | null;
  routeAndBook(from: string, to: string, quantity: number): RouteBooking | null;
}

interface Deficit { systemId: string; goodId: string; shortfall: number; severity: number; }
interface Surplus {
  systemId: string;
  goodId: string;
  /** Spent down in place as deficits draw on this donor — the live remainder. */
  drawable: number;
  order: number;
}

/**
 * Greedy surplus→deficit matching for ONE faction's systems (or all independents).
 * Budget = Σ system.generation, spent as the summed priced cost of what `booker.routeAndBook`
 * actually places. Worst-deficit-first; each deficit fills from every same-faction donor holding
 * drawable surplus, in ascending `priceFrom`-order (frozen for that deficit's whole fan-out), until
 * its shortfall is met, donors are exhausted, or an unaffordable draw ends this deficit's fill —
 * the **per-deficit skip** that replaces the old run-terminating budget clamp
 * (`docs/planned/logistics-lanes.md` §2): the remaining budget carries forward to the next
 * deficit rather than zeroing for the whole run, so one dear draw no longer starves every deficit
 * behind it. A haul the booker splits across multiple paths under congestion yields one
 * `PlannedTransfer` per placement, its quantities summing to what the booker actually placed — the
 * unplaced remainder is congestion, which the booker itself records as blocked volume, and is
 * neither drawn from the donor, billed, nor treated as unservable or funding-bound here.
 */
export function matchFactionTransfers(
  systems: SystemLogisticsState[],
  booker: RouteBookerFor,
): TransferMatchResult {
  let budget = 0;
  for (const s of systems) budget += s.generation;

  // Classify each (system, good) as deficit or surplus. Mutable drawable/stock-shortfall as we allocate.
  const deficits: Deficit[] = [];
  const surplusesByGood = new Map<string, Map<string, Surplus>>();

  for (let systemOrder = 0; systemOrder < systems.length; systemOrder++) {
    const s = systems[systemOrder];
    for (const g of s.goods) {
      // Sink test: stock plus what is already in flight toward this good, so a delivery already
      // dispatched does not order a second one (docs/planned/logistics-lanes.md §3). The donor
      // test below stays on physical stock alone.
      const c = classifyMarketState(g.stock + (g.scheduledInbound ?? 0), g.logisticsTarget);
      // Self-supply gate: a system that produces at least its own demand is never a deficit
      // sink for that good (it refills from its own output), even when standing stock dips below
      // the warehousing target. Without this, high-throughput producers — which hold little
      // inventory relative to their demand rate — read as deficits and get shipped a good they
      // already make, piling stock to the ceiling and decaying their own producers.
      if (c.kind === "deficit" && c.shortfall > 0 && g.production < g.demand) {
        // Triage weight reads the DRAW figure: a factory that cannot run right now — its own yard
        // full, or an event holding its rate down — should not outrank one that is idle for want of
        // this very delivery. Membership above is still decided on the use figure, so the queue
        // reorders without anyone dropping out of it.
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, severity: c.shortfall * g.drawDemand });
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

  deficits.sort((a, b) => b.severity - a.severity);

  const transfers: PlannedTransfer[] = [];
  const fundingBound: FundingBoundMatch[] = [];
  const unservable: UnservableDeficit[] = [];
  const blocked: RouteBlocked[] = [];
  let budgetSkipped = 0;
  for (const d of deficits) {
    const sources = surplusesByGood.get(d.goodId);
    if (!sources) {
      // No system anywhere in this faction currently holds surplus of this good at all — the
      // deficit queue already guarantees no local production can close it (self-supply gate above),
      // so this is the plainest structural case: no reachable donor, full stop. Reachable capacity
      // is 0, so the level below is the whole want — the same `shortfall − reachableDrawable` the
      // general test computes, with nothing to subtract.
      unservable.push({ goodId: d.goodId, systemId: d.systemId, shortfall: d.shortfall });
      continue;
    }

    // One search from this sink, frozen for its whole donor fan-out — later deficits re-search and
    // see this deficit's bookings.
    const priceFor = booker.priceFrom(d.systemId);

    // Two figures off one walk of this deficit's donors.
    //
    // `candidates` — every willing donor with something LEFT to give and an open priced path,
    // cheapest first (tie: stable system order), one or more `PlannedTransfer` rows per donor-draw
    // (the booker may split a single draw across paths under congestion). A single-donor cap here
    // left reachable stock unshipped beside standing deficits (~42% of equilibrium unmet tonnage in
    // the attribution run). A dry donor is excluded: it could only contribute a zero-quantity draw.
    //
    // `reachableDrawable` — total capacity this deficit can actually reach, summed from each priced
    // donor's LIVE drawable, i.e. what it still holds after the deficits ahead of it in the queue
    // took their share. A donor `priceFor` returns null for (no open path with capacity left) is not
    // reachable for this test, exactly as an out-of-radius donor was not before the hop cap was
    // deleted. The structural test asks whether the shortfall is closeable with what exists, not
    // whether it would be closeable were this deficit the only one asking: where a faction's demand
    // for a good outruns its supply, the deficits left with nothing are unservable in the plainest
    // sense and have to say so. A donor already drawn dry contributes 0 here and is skipped as a
    // candidate below — it could only ship a zero-quantity draw. Deliberately independent of the
    // budget mechanics that decide `fundingBound` too: the two questions are "does enough exist" and
    // "did money reach what exists", and a deficit can fail both at once (see the type's own docstring).
    let reachableDrawable = 0;
    const candidates: Array<{ source: Surplus; perUnit: number }> = [];
    for (const [sourceSystemId, source] of sources) {
      const perUnit = priceFor(sourceSystemId);
      if (perUnit === null) continue;
      reachableDrawable += source.drawable;
      if (source.drawable <= 0) continue;
      candidates.push({ source, perUnit });
    }
    candidates.sort(
      (a, b) => a.perUnit - b.perUnit || a.source.order - b.source.order,
    );

    let remaining = d.shortfall;
    let stoppedDonorId: string | null = null;
    for (const { source, perUnit } of candidates) {
      if (remaining <= 0) break;

      // Continuous goods — no quantization to whole units (rounding down loses up to one
      // unit per transfer, negligible at high ECONOMY_SCALE but a large fraction of a small
      // budget at low scale, breaking scale-invariance of budget-bound transfers).
      const wanted = Math.min(remaining, source.drawable);
      const affordable = budget > 0 ? budget / perUnit : 0;
      const quantity = Math.min(wanted, affordable);
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
        }
        // The booker may place less than `quantity` under congestion (RouteBooking.blocked) — the
        // unplaced part is neither drawn from the donor nor billed, and it is not this function's
        // concern: the booker records it as blocked volume on the lane, not as `unservable` or
        // `fundingBound` (docs/planned/logistics-lanes.md §2, "capacity-blocked volume is its own
        // signal").
        source.drawable -= placedTotal;
        remaining -= placedTotal;
      }
      // An unaffordable draw ends THIS deficit's fill: later donors here are unaffordable too, and
      // iterating them would only fan out epsilon-sized transfers from float residue. Unlike the
      // retired run-terminating clamp, the budget itself is left exactly as spent — the remaining
      // budget stays available to fund cheaper deficits behind this one in the queue, which is the
      // gradual binding §2 wants in place of a single cliff. Classification continues either way
      // (see the docstring).
      if (affordable < wanted) {
        stoppedDonorId = source.systemId;
        budgetSkipped++;
        break;
      }
    }

    // Funding-bound is a gameplay gate (planner suppression, idle-decay exemption), so it records
    // "this shortfall persists because of money" — a budget-stopped draw alone is not enough when
    // earlier donors already served the deficit to within the materiality line.
    if (
      stoppedDonorId !== null
      && remaining > d.shortfall * DIRECTED_LOGISTICS.FUNDING_BOUND_RESIDUAL_FRACTION
    ) {
      fundingBound.push({
        goodId: d.goodId,
        fromSystemId: stoppedDonorId,
        toSystemId: d.systemId,
      });
    }

    // Structural: every reachable donor's remaining capacity, spent with no budget limit at all,
    // still leaves this much of the shortfall standing. The LEVEL is that residue, not the whole
    // want — the part the deficit does get served is not unserved — and both the test and the level
    // are decided against `reachableDrawable`, never against `remaining`: `remaining` reflects
    // however far the budget-limited loop actually got, which is exactly the quantity `fundingBound`
    // above already answers for.
    if (reachableDrawable < d.shortfall) {
      unservable.push({
        goodId: d.goodId,
        systemId: d.systemId,
        shortfall: d.shortfall - reachableDrawable,
      });
    }
  }

  return { transfers, fundingBound, unservable, budgetSkipped, blocked };
}
