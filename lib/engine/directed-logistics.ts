/**
 * Pure directed-logistics matching — zero DB dependency. The processor computes
 * per-system supply/demand/band numbers (reusing capacityGoodRates / inputDemandForGood /
 * marketBandForRow) and a route-cost function; this engine just classifies and matches.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

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
 * real demand. Realized production keeps suppressed or input-starved former exporters on the
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
  /** Realized production rate from the last economy assessment. A system that self-supplies (production >= demand) is never a deficit sink. */
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
}

export interface SystemLogisticsState {
  systemId: string;
  factionId: string | null;
  generation: number;
  goods: GoodMarketState[];
}

export interface PlannedTransfer {
  goodId: string;
  fromSystemId: string;
  toSystemId: string;
  quantity: number;
  cost: number;
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
 * One deficit no reachable same-faction donor — at its currently drawable capacity, summed across
 * every candidate, before any budget is spent — could close, even given unlimited haul budget.
 * Local production is not restated here: every entry in the deficit queue already failed the
 * self-supply gate (`production < demand`), so "no local production can close it" already holds for
 * anything that reaches this test.
 *
 * Independent of `FundingBoundMatch`, which records the budget stopping a fill that had enough
 * reachable capacity to succeed. The two are decided from different quantities (summed candidate
 * `drawable` vs. the budget-stopped donor's own draw) and are not mutually exclusive: a deficit whose
 * reachable donors are jointly too small AND whose fill also hits the budget wall before exhausting
 * them carries both. The processor records the deficit endpoint only — donors never appear here,
 * unlike `FundingBoundMatch`, which names both ends of the haul it describes.
 */
export interface UnservableDeficit {
  goodId: string;
  systemId: string;
}

export interface TransferMatchResult {
  transfers: PlannedTransfer[];
  fundingBound: FundingBoundMatch[];
  unservable: UnservableDeficit[];
}

/** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
export type RouteCost = (fromSystemId: string, toSystemId: string) => number | null;

/**
 * Candidate source systems inside the route lookup's bounded neighbourhood. The second argument is
 * the complete faction system list so small standalone callers can deliberately use the fallback
 * without constructing a topology index.
 */
export type ReachableSystemIds = (
  toSystemId: string,
  allSystemIds: readonly string[],
) => Iterable<string>;

export const allSystemIdsReachable: ReachableSystemIds = (_toSystemId, allSystemIds) => allSystemIds;

interface Deficit { systemId: string; goodId: string; shortfall: number; severity: number; }
interface Surplus { systemId: string; goodId: string; drawable: number; order: number; }

/**
 * Greedy surplus→deficit matching for ONE faction's systems (or all independents).
 * Budget = Σ system.generation, spent as quantity × routeCost. Worst-deficit-first; each deficit
 * then fills from every reachable donor in ascending route-cost order until its shortfall is met,
 * donors are exhausted, or the budget is spent — one transfer row per donor-draw. Transfers stop
 * when budget is exhausted, while bounded-neighbour classification continues so
 * wanted-but-unfunded endpoints remain observable.
 */
export function matchFactionTransfers(
  systems: SystemLogisticsState[],
  routeCost: RouteCost,
  reachableSystemIds: ReachableSystemIds = allSystemIdsReachable,
): TransferMatchResult {
  let budget = 0;
  for (const s of systems) budget += s.generation;
  const allSystemIds = systems.map((system) => system.systemId);

  // Classify each (system, good) as deficit or surplus. Mutable drawable/stock-shortfall as we allocate.
  const deficits: Deficit[] = [];
  const surplusesByGood = new Map<string, Map<string, Surplus>>();

  for (let systemOrder = 0; systemOrder < systems.length; systemOrder++) {
    const s = systems[systemOrder];
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.logisticsTarget);
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
  for (const d of deficits) {
    const sources = surplusesByGood.get(d.goodId);
    if (!sources) {
      // No system anywhere in this faction currently holds surplus of this good at all — the
      // deficit queue already guarantees no local production can close it (self-supply gate above),
      // so this is the plainest structural case: no reachable donor, full stop.
      unservable.push({ goodId: d.goodId, systemId: d.systemId });
      continue;
    }

    // Every willing donor serves the deficit, cheapest route first (tie: stable system order) —
    // one PlannedTransfer per donor-draw. A single-donor cap here left reachable stock unshipped
    // beside standing deficits (~42% of equilibrium unmet tonnage in the attribution run).
    const candidates: Array<{ source: Surplus; perUnit: number }> = [];
    for (const sourceSystemId of reachableSystemIds(d.systemId, allSystemIds)) {
      const source = sources.get(sourceSystemId);
      if (source === undefined) continue;
      if (source.drawable <= 0) continue;
      const perUnit = routeCost(source.systemId, d.systemId);
      if (perUnit === null || perUnit <= 0) continue;
      candidates.push({ source, perUnit });
    }
    candidates.sort(
      (a, b) => a.perUnit - b.perUnit || a.source.order - b.source.order,
    );

    // Total drawable capacity reachable for this deficit, summed BEFORE the draw loop below spends
    // any of it — the structural test asks whether the shortfall is closeable at all, which unlimited
    // budget could never change once this number is already short. Deliberately independent of the
    // budget mechanics that decide `fundingBound`: the two questions are "does enough exist" and "did
    // money reach what exists", and a deficit can fail both at once (see the type's own docstring).
    let reachableDrawable = 0;
    for (const candidate of candidates) reachableDrawable += candidate.source.drawable;

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
        const cost = quantity * perUnit;
        transfers.push({
          goodId: d.goodId,
          fromSystemId: source.systemId,
          toSystemId: d.systemId,
          quantity,
          cost,
        });
        source.drawable -= quantity;
        remaining -= quantity;
        budget -= cost;
      }
      // A budget-stopped draw ends this deficit's fill: later donors are unaffordable too, and
      // iterating them would only fan out epsilon-sized transfers from float residue. The budget
      // is clamped to exactly 0 for the same reason — `(budget / perUnit) * perUnit` can round
      // below `budget`, and the residue would leak one sub-epsilon transfer into every remaining
      // deficit. Classification continues either way (see the docstring).
      if (affordable < wanted) {
        stoppedDonorId = source.systemId;
        budget = 0;
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

    // Structural: even every reachable donor's FULL drawable capacity, spent with no budget limit at
    // all, would not have closed this shortfall. Decided against `reachableDrawable` (fixed before
    // the draw loop above ran), never against `remaining` — `remaining` reflects however far the
    // budget-limited loop actually got, which is exactly the quantity `fundingBound` above already
    // answers for.
    if (reachableDrawable < d.shortfall) {
      unservable.push({ goodId: d.goodId, systemId: d.systemId });
    }
  }

  return { transfers, fundingBound, unservable };
}
