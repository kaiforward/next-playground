/**
 * PopulationWorld — data interface for the population processor.
 *
 * The processor runs over the systems the economy just processed this tick (the
 * economy shard), reading the dissatisfaction and supply regime the economy recorded
 * for them. The adapter in `lib/tick/adapters/memory/population.ts` implements this.
 */
import type { UnrestParams, PopulationParams } from "@/lib/engine/population";
export interface PopulationStateView {
  systemId: string;
  population: number;
  popCap: number;
  unrest: number;
}

export interface PopulationUpdate {
  systemId: string;
  population: number;
  unrest: number;
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
  /** Cycle length in ticks; rates are reference-denominated and scaled by catchUpFactor. */
  interval: number;
  /** Per-system additive unrest pressure from the owning faction's tax level
   *  (TAX_LEVEL_UNREST_PRESSURE). Enters the unrest integrator's standing-pressure
   *  floor only; missing system or omitted map → 0. */
  taxPressureBySystem?: ReadonlyMap<string, number>;
}
