/**
 * InfrastructureWorld — data interface for the infrastructure-decay processor.
 *
 * The adapter in `lib/tick/adapters/memory/infrastructure.ts` implements this.
 * The shared processor body (`runInfrastructureDecayProcessor`) reads the building
 * roster + population + unrest, computes downward-only count deltas off the economy's
 * fresh signals, and writes them plus the recomputed popCap.
 *
 * See `docs/active/engineering/processor-architecture.md` for the broader pattern.
 */
import type { DecayParams } from "@/lib/engine/infrastructure-decay";

export interface InfrastructureStateView {
  systemId: string;
  population: number;
  unrest: number;
  /** buildingType → whole-integer level count. */
  buildings: Record<string, number>;
  /** buildingType → sustained-idle countdown (the decay buffer's state). */
  buildingIdleMonths: Record<string, number>;
  /** buildingType → fractional unrest-collapse accumulator (the catastrophic channel's state). */
  buildingCollapseDebt: Record<string, number>;
}

/** One building's decayed count (downward-only; floored at 0 by the adapter). */
export interface BuildingCountUpdate {
  systemId: string;
  buildingType: string;
  count: number;
}

/** One building's new sustained-idle countdown. */
export interface IdleMonthsUpdate {
  systemId: string;
  buildingType: string;
  idleMonths: number;
}

/** One building's new unrest-collapse debt (the catastrophic channel's persisted state). */
export interface CollapseDebtUpdate {
  systemId: string;
  buildingType: string;
  collapseDebt: number;
}

export interface PopCapUpdate {
  systemId: string;
  popCap: number;
}

export interface InfrastructureWorld {
  /** Building roster + idle countdowns + population + unrest for the given systems (this tick's shard). */
  getInfrastructureState(systemIds: string[]): Promise<InfrastructureStateView[]>;
  /** Bulk-write decayed building counts. Downward-only: never raises a count. */
  applyBuildingDecays(updates: BuildingCountUpdate[]): Promise<void>;
  /** Bulk-write updated idle countdowns (the decay buffer's persisted state). */
  applyIdleMonths(updates: IdleMonthsUpdate[]): Promise<void>;
  /** Bulk-write updated collapse debts (the catastrophic channel's persisted state). */
  applyCollapseDebts(updates: CollapseDebtUpdate[]): Promise<void>;
  /** Bulk-write recomputed popCap for systems whose housing changed. */
  applyPopCapUpdates(updates: PopCapUpdate[]): Promise<void>;
}

/** Per-run params passed alongside the world. */
export interface InfrastructureProcessorParams {
  decay: DecayParams;
  /** Pulse interval in ticks; decay counters accrue catchUpFactor(interval) per run. */
  interval: number;
}
