/**
 * InfrastructureWorld — data interface for the infrastructure-decay processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/infrastructure.ts` implement this.
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
  /** buildingType → count. */
  buildings: Record<string, number>;
}

/** One building's decayed count (downward-only; floored at 0 by the adapter). */
export interface BuildingCountUpdate {
  systemId: string;
  buildingType: string;
  count: number;
}

export interface PopCapUpdate {
  systemId: string;
  popCap: number;
}

export interface InfrastructureWorld {
  /** Building roster + population + unrest for the given systems (this tick's shard). */
  getInfrastructureState(systemIds: string[]): Promise<InfrastructureStateView[]>;
  /** Bulk-write decayed building counts. Downward-only: never raises a count. */
  applyBuildingDecays(updates: BuildingCountUpdate[]): Promise<void>;
  /** Bulk-write recomputed popCap for systems whose housing changed. */
  applyPopCapUpdates(updates: PopCapUpdate[]): Promise<void>;
}

/** Per-run params passed alongside the world. */
export interface InfrastructureProcessorParams {
  decay: DecayParams;
}
