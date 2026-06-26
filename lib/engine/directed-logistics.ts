/**
 * Pure directed-logistics matching — zero DB dependency. The processor computes
 * per-system supply/demand/band numbers (reusing capacityGoodRates / inputDemandForGood /
 * marketBandForRow) and a route-cost function; this engine just classifies and matches.
 * See docs/plans/sp5-autonomic-logistics.md.
 */
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

/** This system's per-cycle logistics work-budget contribution (free, population-scaled in v1). */
export function systemLogisticsGeneration(population: number): number {
  return Math.max(0, population) * DIRECTED_LOGISTICS.GENERATION_PER_POP;
}

export interface GoodMarketState {
  goodId: string;
  stock: number;
  /** Days-of-supply price anchor (TARGET_COVER × demandRate). Deficit ⇔ stock < targetStock × DEFICIT_FRACTION; surplus ⇔ stock ≥ targetStock × SURPLUS_MARGIN. Both converge toward targetStock. */
  targetStock: number;
  /** Total local demand rate (civilian + industrial). Severity weight only. */
  demand: number;
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
      if (g.stock < g.targetStock * DIRECTED_LOGISTICS.DEFICIT_FRACTION) {
        const shortfall = g.targetStock - g.stock;
        if (shortfall > 0) {
          deficits.push({ systemId: s.systemId, goodId: g.goodId, shortfall, severity: shortfall * g.demand });
        }
      } else if (g.stock >= g.targetStock * DIRECTED_LOGISTICS.SURPLUS_MARGIN) {
        const drawable = g.stock - g.targetStock;
        if (drawable > 0) {
          const list = surplusesByGood.get(g.goodId) ?? [];
          list.push({ systemId: s.systemId, goodId: g.goodId, drawable });
          surplusesByGood.set(g.goodId, list);
        }
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
