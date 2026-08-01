/**
 * Cohorted harness metrics — the report's supply readings split by which role a market
 * plays for a good, and what kind of world a system is.
 *
 * Every galaxy-wide analyzer beside this one keeps its own definition; this module is
 * additive, so a figure measured against the aggregate stays comparable.
 */

import { MIN_DEMAND } from "@/lib/constants/market-economy";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { MarketRole } from "./types";

/**
 * A market's role, tested in a fixed order because one market can satisfy several
 * descriptions. `state.demand` is the unfloored logistics demand and decides exporter
 * status; `demandRate` is the MIN_DEMAND-floored pricing anchor and is the only thing
 * that can identify an inert market. They are different numbers and answer different
 * questions — MIN_DEMAND's own docstring calls it a floor on the cycles-of-supply
 * denominator "so a near-empty system yields a finite cover instead of a divide-by-zero",
 * i.e. a pricing guard, not demand.
 *
 * Precedence matters at one junction: a mining world producing ore nobody there consumes
 * has a floored demandRate and real production. It is an exporter — it genuinely ships the
 * good — so the production tests run first and `inert` means "neither produces nor really
 * demands", a market that is pure pricing-floor artifact.
 */
export function classifyMarketRole(state: GoodMarketState, demandRate: number): MarketRole {
  const production = state.production ?? 0;
  // Mirrors surplusDrawable's own exporter branch, so a market this calls an exporter is
  // exactly one directed logistics would draw from.
  if (production > state.demand && !state.productionSuppressed) return "exporter";
  if (production > 0) return "self-supplier";
  // The floor is assigned from the same constant, not computed, so a floored row lands on
  // it exactly; the epsilon only guards against accumulated float drift in the industrial term.
  if (demandRate > MIN_DEMAND * (1 + 1e-9)) return "consumer";
  return "inert";
}
