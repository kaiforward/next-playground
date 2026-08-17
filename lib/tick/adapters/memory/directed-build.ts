import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
  FoundingStagingDraw,
  ProposalPersistenceUpdate,
} from "@/lib/tick/world/directed-build-world";
import type { WorldConstructionProject } from "@/lib/world/types";
import { developmentRefs, type DevelopmentRefs } from "@/lib/engine/development";
import { sumResourceVector } from "@/lib/engine/resources";

/** The DirectedBuildWorld adapter — the only backend. Captures writes for assertions + write-back. */
export class MemoryDirectedBuildWorld implements DirectedBuildWorld {
  /** New absolute building counts written this run (landed whole levels). */
  readonly buildingUpdates: BuildBuildingUpdate[] = [];
  /** Ownership claims resolved this run (control tier). */
  readonly claims: SystemClaim[] = [];
  /** Developments resolved this run (developed tier + colony seed). */
  readonly developments: SystemDevelopment[] = [];
  /** Materials drawn from founding sources this run (per-cycle colony staging). */
  readonly foundingStagingDraws: FoundingStagingDraw[] = [];
  /** Proposal-pressure counters written this run, keyed by composite market id, clamped to a finite [0,2]. */
  readonly proposalCycleUpdates = new Map<string, number>();
  /** The live open-project set — updated in place by applyConstructionUpdates; read back by the tick body. */
  constructionProjects: WorldConstructionProject[];

  constructor(
    private readonly systems: SystemBuildRow[],
    constructionProjects: WorldConstructionProject[] = [],
  ) {
    this.constructionProjects = constructionProjects;
  }

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const seen = new Set<string | null>();
    for (const s of this.systems) seen.add(s.factionId);
    return [...seen];
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemBuildRow[]> {
    const set = new Set(factionKeys);
    return this.systems.filter((s) => set.has(s.factionId));
  }

  async getDevelopmentRefs(): Promise<DevelopmentRefs> {
    // Universe-wide over the full system set (all factions + independents), not a per-faction shard.
    return developmentRefs(
      this.systems.map((s) => ({
        habitableSpace: s.habitableSpace,
        generalSpace: s.generalSpace,
        depositSlots: sumResourceVector(s.slotCap),
      })),
    );
  }

  async getConstructionProjects(factionKeys: Array<string | null>): Promise<WorldConstructionProject[]> {
    const set = new Set(factionKeys);
    return this.constructionProjects.filter((p) => set.has(p.factionId));
  }

  async applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void> {
    this.buildingUpdates.push(...updates);
  }

  async applyConstructionUpdates(
    factionKeys: Array<string | null>,
    projects: WorldConstructionProject[],
  ): Promise<void> {
    const set = new Set(factionKeys);
    // Replace exactly the due factions' projects (the shard processed all of theirs) with the new set.
    this.constructionProjects = [
      ...this.constructionProjects.filter((p) => !set.has(p.factionId)),
      ...projects,
    ];
  }

  async applyProposalPersistenceUpdates(updates: ProposalPersistenceUpdate[]): Promise<void> {
    // Clamp to a finite [0,2] at the boundary (the counter is fractional reference-time, not an
    // assessment count), mirroring how the economy adapter narrows squeezeCycles.
    for (const u of updates) {
      const clamped = Number.isFinite(u.proposalCycles)
        ? Math.max(0, Math.min(2, u.proposalCycles))
        : 0;
      this.proposalCycleUpdates.set(u.id, clamped);
    }
  }

  async applyClaims(claims: SystemClaim[]): Promise<void> {
    this.claims.push(...claims);
  }

  async applyDevelopments(developments: SystemDevelopment[]): Promise<void> {
    this.developments.push(...developments);
  }

  async applyFoundingStagingDraws(draws: FoundingStagingDraw[]): Promise<void> {
    this.foundingStagingDraws.push(...draws);
  }
}
