/**
 * PopulationWorld — data interface for the population processor.
 *
 * The processor runs over the systems the economy just processed this tick (the
 * economy shard), reading the dissatisfaction and supply regime the economy recorded
 * for them. The adapter in `lib/tick/adapters/memory/population.ts` implements this.
 */
import type { UnrestParams, PopulationParams, SupplyRegime } from "@/lib/engine/population";
import type { ExpectationParams } from "@/lib/engine/expectation";
export interface PopulationStateView {
  systemId: string;
  population: number;
  popCap: number;
  unrest: number;
  /** Stored Provision memory (adaptive expectation), carried from the system row unmodified.
   *  Optional: absent means never seeded — `readExpectation` (lib/engine/expectation.ts) is the
   *  only place that turns absence into a value, never a `?? 0` at this seam. */
  provisionExpectation?: number;
}

export interface PopulationUpdate {
  systemId: string;
  population: number;
  unrest: number;
  /** This cycle's resolved memory value — absent for exactly one case: a never-seeded system (no
   *  stored value on the way in) whose basket was empty this cycle. That combination must not
   *  persist Provision's own empty-basket-artifact seed (`readExpectation`'s `provision = 1`
   *  fallback) as if it were a real memory, so the field stays absent rather than writing a false
   *  1. Every other path writes a number: a system with an existing stored value carries it
   *  unchanged through an empty-basket cycle, and a non-empty cycle always writes the resolved
   *  update. The adapter (`lib/tick/adapters/memory/population.ts`) treats an absent write here
   *  the same as a non-finite one — keep the row's prior value if it has one, else stay absent. */
  provisionExpectation?: number;
  /** This cycle's Provisioned (P = 1 − d), read from the same `dissatisfactionBySystem` entry the
   *  unrest read already consumed for this system — never a re-derived mean. Unlike
   *  `provisionExpectation` above, this carries no memory across cycles: the adapter drops a
   *  non-finite write straight to absent rather than keeping the prior cycle's figure (see
   *  `lib/world/types.ts` for the full absence convention). */
  provision?: number;
  /** This cycle's supply band (`SupplyState.regime`), read from the matching
   *  `supplyStateBySystem` entry — absent (not the processor's defensive "supplied" default) when
   *  the economy genuinely left this system unclassified this cycle. Same no-memory write
   *  convention as `provision`. */
  supplyBand?: SupplyRegime;
}

export interface PopulationWorld {
  /** population/popCap/unrest for the given systems. */
  getPopulationState(systemIds: string[]): Promise<PopulationStateView[]>;
  /** Bulk-write population + unrest. */
  applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void>;
  /**
   * Rewrite both per-market demand figures for those systems' markets, in one pass:
   * `demandRate`, the floored capacity-based pricing anchor (civilian basis + industrial input
   * draw), and `honestUseRate`, the unfloored use figure warehousing is denominated in (civilian
   * want at full rate + the recipe draw scaled by `productionSuppress`, the system's strike ×
   * maintenance scalar ∈ (0,1]). The strike scalar reaches only the use figure — pricing does
   * not move with labour action.
   */
  rewriteDemandRates(
    pops: Array<{ systemId: string; population: number; productionSuppress: number }>,
  ): Promise<void>;
}

/** Per-run params passed alongside the world, all sourced by `runWorldTick`; calibratable. */
export interface PopulationProcessorParams {
  unrest: UnrestParams;
  population: PopulationParams;
  /** Adaptive expectation: the read/update rates and floor (lib/engine/expectation.ts). */
  expectation: ExpectationParams;
  /** Cycle length in ticks; rates are reference-denominated and scaled by catchUpFactor. */
  interval: number;
  /** Per-system additive unrest pressure from the owning faction's tax level
   *  (TAX_LEVEL_UNREST_PRESSURE). Enters the unrest integrator's standing-pressure
   *  floor only; missing system or omitted map → 0. */
  taxPressureBySystem?: ReadonlyMap<string, number>;
}
