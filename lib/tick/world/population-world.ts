/**
 * PopulationWorld — data interface for the population processor.
 *
 * The processor runs over the systems the economy just processed this tick (the
 * round-robin region), reading the dissatisfaction the economy recorded for them.
 * Adapters in `lib/tick/adapters/{prisma,memory}/population.ts` implement this.
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
  /** Recompute demandRate = demandRateForGood(good, population) for those systems' markets. */
  rewriteDemandRates(pops: Array<{ systemId: string; population: number }>): Promise<void>;
}

/** Per-run params (sim and live differ; calibratable). */
export interface PopulationProcessorParams {
  unrest: UnrestParams;
  population: PopulationParams;
}
