import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
} from "@/lib/tick/world/directed-build-world";

/** In-memory DirectedBuildWorld for unit tests + the simulator. Captures writes for assertions + write-back. */
export class MemoryDirectedBuildWorld implements DirectedBuildWorld {
  /** New absolute building counts written this run. */
  readonly buildingUpdates: BuildBuildingUpdate[] = [];

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
}
