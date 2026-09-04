import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
  FoundingStagingDraw,
  ProposalPersistenceUpdate,
  BuildBlockedUpdate,
  BuildOpportunityUpdate,
  ColonyOpportunityUpdate,
} from "@/lib/tick/world/directed-build-world";
import type { WorldConstructionProject } from "@/lib/world/types";
import { developmentRefs, type DevelopmentRefs } from "@/lib/engine/development";
import { sumResourceVector } from "@/lib/engine/resources";
import type { LaneLevelIncrease } from "@/lib/engine/lanes";

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
  /** Every system belonging to a due faction this run (Build blocked's "visited" set) — a system
   *  here with no matching entry in `buildBlockedUpdates` had nothing dropped. */
  readonly buildBlockedVisitedSystemIds: string[] = [];
  /** This run's best-ranked dropped production opportunity, one entry per system that had one. */
  readonly buildBlockedUpdates: BuildBlockedUpdate[] = [];
  /** Same visited set as `buildBlockedVisitedSystemIds` (Build opportunity shares Build blocked's
   *  assessment run) — a system here with no matching entry in `buildOpportunityUpdates` had nothing
   *  scored. */
  readonly buildOpportunityVisitedSystemIds: string[] = [];
  /** This run's best-ranked SCORED production opportunity, one entry per system that had one. */
  readonly buildOpportunityUpdates: BuildOpportunityUpdate[] = [];
  /** Every colony-establish CANDIDATE the colonisation planner considered this run — a candidate here
   *  with no matching entry in `colonyOpportunityUpdates` had nothing proposed for it. */
  readonly colonyOpportunityVisitedSystemIds: string[] = [];
  /** This run's best-ranked colony-establish terms, one entry per candidate that was proposed. */
  readonly colonyOpportunityUpdates: ColonyOpportunityUpdate[] = [];
  /** The live open-project set — updated in place by applyConstructionUpdates; read back by the tick body. */
  constructionProjects: WorldConstructionProject[];
  /** Landed lane_upgrade levels this run, by laneKey — read back by the tick body and folded into `lanes`. */
  readonly laneLevelIncreases: LaneLevelIncrease[] = [];

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
        peopleLand: s.peopleLand,
        depositCounts: sumResourceVector(s.depositCounts),
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

  async applyBuildBlockedUpdates(visitedSystemIds: string[], updates: BuildBlockedUpdate[]): Promise<void> {
    this.buildBlockedVisitedSystemIds.push(...visitedSystemIds);
    this.buildBlockedUpdates.push(...updates);
  }

  async applyBuildOpportunityUpdates(visitedSystemIds: string[], updates: BuildOpportunityUpdate[]): Promise<void> {
    this.buildOpportunityVisitedSystemIds.push(...visitedSystemIds);
    this.buildOpportunityUpdates.push(...updates);
  }

  async applyColonyOpportunityUpdates(visitedSystemIds: string[], updates: ColonyOpportunityUpdate[]): Promise<void> {
    this.colonyOpportunityVisitedSystemIds.push(...visitedSystemIds);
    this.colonyOpportunityUpdates.push(...updates);
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

  async applyLaneLevelIncreases(updates: LaneLevelIncrease[]): Promise<void> {
    this.laneLevelIncreases.push(...updates);
  }
}
