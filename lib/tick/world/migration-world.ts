import type { EdgeView } from "@/lib/tick/world/trade-flow-topology";
import type { MigrationFlowParams } from "@/lib/engine/migration";

export interface MigrationNodeView { systemId: string; population: number; popCap: number; unrest: number; }
/** Signed population change for one system (Σ over a run = 0 — conserved). */
export interface MigrationDelta { systemId: string; delta: number; }

export interface MigrationWorld {
  /** Faction-bounded open edges (same source as trade-flow), stably ordered. */
  getOpenEdges(): Promise<EdgeView[]>;
  /** population/popCap/unrest for the sliced systems. */
  getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]>;
  /** Apply signed population deltas (population += delta, floored at 0). */
  applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void>;
}

export interface MigrationProcessorParams {
  /** Ticks for the edge shard to sweep every open edge once (fixed gameplay cadence). */
  interval: number;
  flow: MigrationFlowParams;
}
