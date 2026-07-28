/**
 * DirectedBuildWorld — data interface for the directed-build processor.
 * The adapter in `lib/tick/adapters/memory/directed-build.ts` implements it.
 * Sharding is PER-FACTION (the build planner needs all of a faction's systems
 * at once), matching logistics.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { DevelopmentRefs } from "@/lib/engine/development";

/** One system's build-relevant state: markets + buildings + body-derived capacity. */
export interface SystemBuildRow {
  systemId: string;
  factionId: string | null;
  /** Three-state ownership: unclaimed frontier → controlled (outpost tier) → developed (build-gate). */
  control: SystemControl;
  population: number;
  /** Stored unrest integral 0…1, as the population processor left it. */
  unrest: number;
  buildings: Record<string, number>;
  /** Per-resource effective yields, for the shared market-state derivation. */
  yields: ResourceVector;
  /** Per-resource deposit-slot cap — caps tier-0 extractor builds. */
  slotCap: ResourceVector;
  /** Fungible general build space — tier-1+ factories + housing. */
  generalSpace: number;
  /** Habitable subset of build space — additionally caps housing. */
  habitableSpace: number;
  /** Raw market band inputs (shared shape with logistics). */
  markets: MarketRowForLogistics[];
}

/** One building-count write: the new ABSOLUTE count for (system, buildingType). */
export interface BuildBuildingUpdate {
  systemId: string;
  buildingType: string;
  count: number;
}

/** One ownership assignment: an unclaimed system becomes owned by factionId (control tier). */
export interface SystemClaim {
  systemId: string;
  factionId: string;
}

/** One proposal-pressure write: the saturating construction assessment counter for a market row. */
export interface ProposalPersistenceUpdate {
  /** Composite market id (`${systemId}|${goodId}`), the same key the economy adapter writes by. */
  id: string;
  /** Reference-months a structural construction assessment has persisted; clamped to a finite [0,2] at
   *  the adapter boundary (advanced per assessment by the construction interval's catchUpFactor). */
  proposalPulses: number;
}

/** One founding-stock line: goods moved from the founding system's market to the colony's. */
export interface FoundingStockLine {
  goodId: string;
  quantity: number;
}

/** One development: a controlled system flips to developed and receives a conserved colony seed + bundled housing. */
export interface SystemDevelopment {
  systemId: string;
  /** Developed same-faction system the seed population is transferred from. */
  sourceSystemId: string;
  seedPop: number;
  /** Housing levels placed on the colony with the establishment (viable by construction). */
  housingLevels: number;
  /**
   * Goods the founding system sends along with the seed, so the colony opens stocked rather than at
   * satisfaction 0 on everything. Conserved — every line is subtracted from `sourceSystemId`'s market
   * and added to `systemId`'s. Empty when the source can spare nothing.
   */
  stockManifest: FoundingStockLine[];
}

export interface DirectedBuildWorld {
  /** Distinct faction groups (incl. one null/independents group) — drives the per-faction shard. */
  getFactionShardKeys(): Promise<Array<string | null>>;
  /** All systems (with markets + capacity) belonging to the given faction keys. */
  getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemBuildRow[]>;
  /** Universe-wide development reference (galaxy's biggest natural potential) over ALL systems, not just a shard. */
  getDevelopmentRefs(): Promise<DevelopmentRefs>;
  /** Open (in-flight) construction projects owned by the given faction keys. */
  getConstructionProjects(factionKeys: Array<string | null>): Promise<WorldConstructionProject[]>;
  /** Bulk absolute building-count writes (landed whole levels: production goods + "housing"). */
  applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void>;
  /** Replace the given factions' open construction projects with the funded/created set (landed removed). */
  applyConstructionUpdates(factionKeys: Array<string | null>, projects: WorldConstructionProject[]): Promise<void>;
  /** Persist the saturating construction proposal-pressure counter per assessed market row. */
  applyProposalPersistenceUpdates(updates: ProposalPersistenceUpdate[]): Promise<void>;
  /** Ownership writes from the claim step (unclaimed → controlled). */
  applyClaims(claims: SystemClaim[]): Promise<void>;
  /** Ownership writes from the develop step (controlled → developed + colony seed transfer). */
  applyDevelopments(developments: SystemDevelopment[]): Promise<void>;
}
