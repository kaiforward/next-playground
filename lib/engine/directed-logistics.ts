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
  /** targetStock − stock when deficit (> 0); else 0. */
  shortfall: number;
  /** stock − targetStock when surplus (> 0); else 0 — never draws below the anchor. */
  drawable: number;
}

/**
 * Classify one good's market against its days-of-supply anchor. Deficit ⇔
 * stock < targetStock × DEFICIT_FRACTION; surplus ⇔ stock ≥ targetStock ×
 * SURPLUS_MARGIN; the dead-band between is balanced. Shared by the logistics
 * matcher and the build planner so both read one definition.
 */
export function classifyMarketState(stock: number, targetStock: number): MarketClassification {
  // A zero/negative demand anchor means no days-of-supply target — never a drawable surplus; treat as balanced.
  if (targetStock <= 0) {
    return { kind: "balanced", shortfall: 0, drawable: 0 };
  }
  if (stock < targetStock * DIRECTED_LOGISTICS.DEFICIT_FRACTION) {
    return { kind: "deficit", shortfall: Math.max(0, targetStock - stock), drawable: 0 };
  }
  if (stock >= targetStock * DIRECTED_LOGISTICS.SURPLUS_MARGIN) {
    return { kind: "surplus", shortfall: 0, drawable: Math.max(0, stock - targetStock) };
  }
  return { kind: "balanced", shortfall: 0, drawable: 0 };
}

/**
 * Drawable directed-logistics surplus for one (system, good): the stock a donor can ship without
 * dropping below its own days-of-supply anchor. Zero unless one of two paths qualifies:
 *  (a) standing stock clears `SURPLUS_MARGIN` — any holder of excess inventory; or
 *  (b) a **structural producer** (`production > demand`) holding stock above its anchor — the mirror
 *      of the deficit-side self-supply gate. Path (b) is required because the economy's production
 *      throttle caps a producer at `HOLD_COVER × targetStock` (~1.3×), *below* the 1.4× margin, so a
 *      structural exporter never reaches path (a); without it directed logistics goes dead for every
 *      good its producers also consume (food, water, biomass).
 * One definition, shared by the logistics matcher and the build planner so both read "surplus" alike.
 */
export function surplusDrawable(stock: number, targetStock: number, demand: number, production: number): number {
  if (targetStock <= 0) return 0;
  const aboveAnchor = stock - targetStock;
  if (aboveAnchor <= 0) return 0;
  const clearsMargin = stock >= targetStock * DIRECTED_LOGISTICS.SURPLUS_MARGIN;
  return clearsMargin || production > demand ? aboveAnchor : 0;
}

/** This system's per-cycle logistics work-budget contribution (free, population-scaled in v1). */
export function systemLogisticsGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_LOGISTICS.GENERATION_PER_POP;
}

export interface GoodMarketState {
  goodId: string;
  stock: number;
  /** Days-of-supply price anchor (TARGET_COVER × demandRate). Deficit ⇔ stock < targetStock × DEFICIT_FRACTION; surplus ⇔ stock ≥ targetStock × SURPLUS_MARGIN. Both converge toward targetStock. */
  targetStock: number;
  /** Total local demand rate (civilian + industrial). Severity weight + the self-supply gate (vs production). */
  demand: number;
  /** Local production rate of this good. A system that self-supplies (production ≥ demand) is never a deficit sink — its low standing stock is throughput, not need, and importing more just piles it against the ceiling and decays its own producers. */
  production: number;
  /** Persisted consumption satisfaction from the last economy pulse (missing ⇒ 1) — the build planner's fed-proxy input; the matcher itself does not read it. */
  satisfaction?: number;
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

export interface FundingBoundMatch {
  goodId: string;
  fromSystemId: string;
  toSystemId: string;
}

export interface TransferMatchResult {
  transfers: PlannedTransfer[];
  fundingBound: FundingBoundMatch[];
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
 * Budget = Σ system.generation, spent as quantity × routeCost. Worst-deficit-first;
 * nearest reachable surplus first. Transfers stop when budget is exhausted, while bounded-neighbour
 * classification continues so wanted-but-unfunded endpoints remain observable.
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
      const c = classifyMarketState(g.stock, g.targetStock);
      // Self-supply gate: a system that produces at least its own demand is never a deficit
      // sink for that good (it refills from its own output), even when standing stock dips below
      // the days-of-supply anchor. Without this, high-throughput producers — which hold little
      // inventory relative to their demand rate — read as deficits and get shipped a good they
      // already make, piling stock to the ceiling and decaying their own producers.
      if (c.kind === "deficit" && c.shortfall > 0 && g.production < g.demand) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, severity: c.shortfall * g.demand });
        continue;
      }
      // Surplus source — standing excess inventory OR a structural producer above its anchor
      // (see surplusDrawable; the latter is what the production throttle would otherwise suppress).
      const drawable = surplusDrawable(g.stock, g.targetStock, g.demand, g.production);
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
  const fundingBoundKeys = new Set<string>();
  for (const d of deficits) {
    const sources = surplusesByGood.get(d.goodId);
    if (!sources) continue;

    // Nearest reachable source first.
    let best: { source: Surplus; perUnit: number } | null = null;
    for (const sourceSystemId of reachableSystemIds(d.systemId, allSystemIds)) {
      const source = sources.get(sourceSystemId);
      if (source === undefined) continue;
      if (source.drawable <= 0) continue;
      const perUnit = routeCost(source.systemId, d.systemId);
      if (perUnit === null || perUnit <= 0) continue;
      if (
        best === null
        || perUnit < best.perUnit
        || (perUnit === best.perUnit && source.order < best.source.order)
      ) {
        best = { source, perUnit };
      }
    }
    if (!best) continue;

    // Continuous goods — no quantization to whole units (rounding down loses up to one
    // unit per transfer, negligible at high ECONOMY_SCALE but a large fraction of a small
    // budget at low scale, breaking scale-invariance of budget-bound transfers).
    const wanted = Math.min(d.shortfall, best.source.drawable);
    const affordable = budget > 0 ? budget / best.perUnit : 0;
    const quantity = Math.min(wanted, affordable);
    if (affordable < wanted) {
      const key = `${d.goodId}|${best.source.systemId}|${d.systemId}`;
      if (!fundingBoundKeys.has(key)) {
        fundingBoundKeys.add(key);
        fundingBound.push({
          goodId: d.goodId,
          fromSystemId: best.source.systemId,
          toSystemId: d.systemId,
        });
      }
    }
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const cost = quantity * best.perUnit;
    transfers.push({
      goodId: d.goodId,
      fromSystemId: best.source.systemId,
      toSystemId: d.systemId,
      quantity,
      cost,
    });
    best.source.drawable -= quantity;
    budget -= cost;
  }

  return { transfers, fundingBound };
}
