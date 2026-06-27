/**
 * Pure directed-logistics matching — zero DB dependency. The processor computes
 * per-system supply/demand/band numbers (reusing capacityGoodRates / inputDemandForGood /
 * marketBandForRow) and a route-cost function; this engine just classifies and matches.
 * See docs/plans/sp5-autonomic-logistics.md.
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

/** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
export type RouteCost = (fromSystemId: string, toSystemId: string) => number | null;

interface Deficit { systemId: string; goodId: string; shortfall: number; severity: number; }
interface Surplus { systemId: string; goodId: string; drawable: number; }

/**
 * Greedy surplus→deficit matching for ONE faction's systems (or all independents).
 * Budget = Σ system.generation, spent as quantity × routeCost. Worst-deficit-first;
 * nearest reachable surplus first. Stops when budget is exhausted → deliberate under-serve.
 */
export function matchFactionTransfers(
  systems: SystemLogisticsState[],
  routeCost: RouteCost,
): PlannedTransfer[] {
  let budget = 0;
  for (const s of systems) budget += s.generation;
  if (budget <= 0) return [];

  // Classify each (system, good) as deficit or surplus. Mutable drawable/stock-shortfall as we allocate.
  const deficits: Deficit[] = [];
  const surplusesByGood = new Map<string, Surplus[]>();

  for (const s of systems) {
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      // Self-supply gate: a system that produces at least its own demand is never a deficit
      // sink for that good (it refills from its own output), even when standing stock dips below
      // the days-of-supply anchor. Without this, high-throughput producers — which hold little
      // inventory relative to their demand rate — read as deficits and get shipped a good they
      // already make, piling stock to the ceiling and decaying their own producers.
      if (c.kind === "deficit" && c.shortfall > 0 && g.production < g.demand) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall: c.shortfall, severity: c.shortfall * g.demand });
      } else if (c.kind === "surplus" && c.drawable > 0) {
        const list = surplusesByGood.get(g.goodId) ?? [];
        list.push({ systemId: s.systemId, goodId: g.goodId, drawable: c.drawable });
        surplusesByGood.set(g.goodId, list);
      }
    }
  }

  deficits.sort((a, b) => b.severity - a.severity);

  const transfers: PlannedTransfer[] = [];
  for (const d of deficits) {
    if (budget <= 0) break;
    const sources = surplusesByGood.get(d.goodId);
    if (!sources) continue;

    // Nearest reachable source first.
    let best: { source: Surplus; perUnit: number } | null = null;
    for (const source of sources) {
      if (source.drawable <= 0) continue;
      const perUnit = routeCost(source.systemId, d.systemId);
      if (perUnit === null || perUnit <= 0) continue;
      if (!best || perUnit < best.perUnit) best = { source, perUnit };
    }
    if (!best) continue;

    const affordable = Math.floor(budget / best.perUnit);
    const quantity = Math.min(d.shortfall, best.source.drawable, affordable);
    if (quantity <= 0) continue;

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

  return transfers;
}

/**
 * Split matched transfers into the top-`count` most valuable — `cost` ≈ quantity ×
 * route distance ≈ player payout — exposed as player Contracts, and the cheaper
 * remainder, which move silently. Tie-broken by original order so the split is
 * deterministic. `count <= 0` (the simulator) → everything silent.
 */
export function splitContractTransfers(
  transfers: PlannedTransfer[],
  count: number,
): { contracts: PlannedTransfer[]; silent: PlannedTransfer[] } {
  if (count <= 0 || transfers.length === 0) {
    return { contracts: [], silent: [...transfers] };
  }
  const ranked = transfers
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.cost - a.t.cost || a.i - b.i);
  const contractIdx = new Set(ranked.slice(0, count).map((r) => r.i));
  const contracts: PlannedTransfer[] = [];
  const silent: PlannedTransfer[] = [];
  transfers.forEach((t, i) => {
    if (contractIdx.has(i)) contracts.push(t);
    else silent.push(t);
  });
  return { contracts, silent };
}
