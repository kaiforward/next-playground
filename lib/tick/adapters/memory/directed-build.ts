import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
} from "@/lib/tick/world/directed-build-world";

/** In-memory DirectedBuildWorld for unit tests + the simulator. Captures writes for assertions + write-back. */
export class MemoryDirectedBuildWorld implements DirectedBuildWorld {
  /** New absolute building counts written this run. */
  readonly buildingUpdates: BuildBuildingUpdate[] = [];
  /** Ownership claims resolved this run (control tier). */
  readonly claims: SystemClaim[] = [];
  /** Developments resolved this run (developed tier + colony seed). */
  readonly developments: SystemDevelopment[] = [];

  constructor(private readonly systems: SystemBuildRow[]) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const seen = new Set<string | null>();
    for (const s of this.systems) seen.add(s.factionId);
    return [...seen];
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemBuildRow[]> {
    const set = new Set(factionKeys);
    return this.systems.filter((s) => set.has(s.factionId));
  }

  async applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void> {
    this.buildingUpdates.push(...updates);
  }

  async applyClaims(claims: SystemClaim[]): Promise<void> {
    this.claims.push(...claims);
  }

  async applyDevelopments(developments: SystemDevelopment[]): Promise<void> {
    this.developments.push(...developments);
  }
}
