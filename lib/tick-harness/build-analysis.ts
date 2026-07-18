/**
 * Colonisation / build-health analysis for the calibration harness.
 *
 * Aggregate market health can look green while the *colonisation build loop* is broken — a colony
 * flips to `developed`, receives its seed population, and then never gets housing or industry built,
 * so it sits with pops on deposits and nothing else. This summary measures that loop directly:
 * how far homeworlds vs colonies get built out, how many developed systems carry population but no
 * industry (the stranded symptom), and whether the construction queue is proposing nothing for
 * colonies (a planner/decision gap) or proposing but never funding them (a pacing/starvation gap).
 */
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldConstructionProject } from "@/lib/world/types";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_TYPES, CONSTRUCTION_CENTRE_TYPE,
} from "@/lib/constants/industry";
import { factionConstructionPool } from "@/lib/engine/construction";
import { CONSTRUCTION } from "@/lib/constants/construction";

/** How a developed system's built base breaks down by role/tier. */
interface BuildBreakdown {
  tier0: number; // extractor levels (deposit-slot goods)
  tier1: number; // processed-good factory levels
  tier2: number; // advanced-good factory levels
  housing: number;
  academy: number; // vocational schools + research institutes
  complex: number; // specialisation complexes
  centre: number; // construction centres
}

function breakdown(buildings: Record<string, number>): BuildBreakdown {
  const b: BuildBreakdown = { tier0: 0, tier1: 0, tier2: 0, housing: 0, academy: 0, complex: 0, centre: 0 };
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    if (type === HOUSING_TYPE) { b.housing += count; continue; }
    if (type === VOCATIONAL_SCHOOL_TYPE || type === RESEARCH_INSTITUTE_TYPE) { b.academy += count; continue; }
    if (COMPLEX_TYPES.includes(type)) { b.complex += count; continue; }
    if (type === CONSTRUCTION_CENTRE_TYPE) { b.centre += count; continue; }
    const tier = GOOD_TIER_BY_KEY[type];
    if (tier === 0) b.tier0 += count;
    else if (tier === 1) b.tier1 += count;
    else if (tier === 2) b.tier2 += count;
  }
  return b;
}

/** Per-class (homeworld / colony) build-out counts across developed systems. */
export interface ClassBuildStats {
  count: number;
  /** Developed systems in this class that host ≥1 production level of the given kind. */
  withTier0: number;
  withTier1Plus: number;
  withHousing: number;
  /** Developed systems carrying population but ZERO production levels (the stranded symptom). */
  populatedButNoIndustry: number;
  /** Developed systems with population but popCap ≈ 0 — housing never built, pop can't grow or be housed. */
  popCapStarved: number;
  totalPopulation: number;
  /** Deposit-bearing systems (Σ slotCap > 0) in this class with no tier-0 extraction built. */
  depositsIdle: number;
}

export interface ColonisationSummary {
  homeworld: ClassBuildStats;
  colony: ClassBuildStats;
  /** Open construction projects, split by target-system class, to tell "proposes nothing" from "never funds". */
  queue: {
    homeworldProjects: number;
    colonyProjects: number;
    homeworldLevels: number;
    colonyLevels: number;
    /** Mean workDone/workTotal over colony-targeted projects (low + persistent ⇒ funding starvation). */
    colonyMeanProgress: number;
    /** Colony-targeted projects by kind, to see whether housing/tier-0 are even being proposed. */
    colonyByKind: Record<string, number>;
  };
}

function slotCapTotal(s: TickSystem): number {
  let n = 0;
  for (const v of Object.values(s.slotCap)) n += Math.max(0, v);
  return n;
}

function emptyClass(): ClassBuildStats {
  return {
    count: 0, withTier0: 0, withTier1Plus: 0, withHousing: 0,
    populatedButNoIndustry: 0, popCapStarved: 0, totalPopulation: 0, depositsIdle: 0,
  };
}

function projectKind(buildingType: string): string {
  if (buildingType === HOUSING_TYPE) return "housing";
  if (buildingType === VOCATIONAL_SCHOOL_TYPE || buildingType === RESEARCH_INSTITUTE_TYPE) return "academy";
  if (COMPLEX_TYPES.includes(buildingType)) return "complex";
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "centre";
  const tier = GOOD_TIER_BY_KEY[buildingType];
  return tier === 0 ? "tier0" : tier === 1 ? "tier1" : tier === 2 ? "tier2" : "other";
}

/**
 * Summarise the colonisation build loop from the final world. `homeworldIds` are the
 * per-faction seeded homeworlds (`world.factions[].homeworldId`); every other developed
 * system is a colony.
 */
export function summarizeColonisation(
  systems: TickSystem[],
  homeworldIds: Set<string>,
  projects: WorldConstructionProject[],
): ColonisationSummary {
  const homeworld = emptyClass();
  const colony = emptyClass();

  for (const s of systems) {
    if (s.control !== "developed") continue;
    const cls = homeworldIds.has(s.id) ? homeworld : colony;
    const b = breakdown(s.buildings);
    const industry = b.tier0 + b.tier1 + b.tier2;

    cls.count++;
    cls.totalPopulation += s.population;
    if (b.tier0 > 0) cls.withTier0++;
    if (b.tier1 + b.tier2 > 0) cls.withTier1Plus++;
    if (b.housing > 0) cls.withHousing++;
    if (s.population > 1 && industry <= 0) cls.populatedButNoIndustry++;
    if (s.population > 1 && s.popCap < 1) cls.popCapStarved++;
    if (slotCapTotal(s) > 0 && b.tier0 <= 0) cls.depositsIdle++;
  }

  const homeworldSet = homeworldIds;
  let homeworldProjects = 0, colonyProjects = 0, homeworldLevels = 0, colonyLevels = 0;
  let colonyProgressSum = 0;
  const colonyByKind: Record<string, number> = {};
  for (const p of projects) {
    if (p.kind !== "build") continue; // colony-establish reporting lands in PR4
    const isHome = homeworldSet.has(p.systemId);
    if (isHome) { homeworldProjects++; homeworldLevels += p.levels; }
    else {
      colonyProjects++;
      colonyLevels += p.levels;
      colonyProgressSum += p.workTotal > 0 ? p.workDone / p.workTotal : 0;
      const kind = projectKind(p.buildingType);
      colonyByKind[kind] = (colonyByKind[kind] ?? 0) + 1;
    }
  }

  return {
    homeworld,
    colony,
    queue: {
      homeworldProjects,
      colonyProjects,
      homeworldLevels,
      colonyLevels,
      colonyMeanProgress: colonyProjects > 0 ? colonyProgressSum / colonyProjects : 0,
      colonyByKind,
    },
  };
}

/** Galaxy-wide construction-pool composition + queue pressure — starvation made visible. */
export interface ConstructionPoolSummary {
  poolBase: number;
  poolCentres: number;
  /** poolCentres / (poolBase + poolCentres); 0 when the pool is empty. */
  centreShare: number;
  /** Built centre levels across developed systems. */
  centreLevels: number;
  /** Open centre build projects. */
  centreProjects: number;
  /** Σ max(0, workTotal − workDone) over all open projects. */
  queueRemainingWork: number;
  /** Pulses to drain the whole open queue at the current total pool; null when the pool is 0. */
  queueEtaPulses: number | null;
}

/**
 * Pool composition (eligible-heads base vs Construction Centre output) and how many pulses the open
 * queue takes to drain at that rate. Composition aggregates linearly over developed systems, so one
 * pass over the whole galaxy equals the per-faction sum.
 */
export function summarizeConstructionPool(
  systems: TickSystem[],
  projects: WorldConstructionProject[],
): ConstructionPoolSummary {
  const pool = factionConstructionPool(
    systems.map((s) => ({ control: s.control, population: s.population, buildings: s.buildings })),
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
  );
  let centreLevels = 0;
  for (const s of systems) {
    if (s.control === "developed") centreLevels += s.buildings[CONSTRUCTION_CENTRE_TYPE] ?? 0;
  }
  let centreProjects = 0;
  let queueRemainingWork = 0;
  for (const p of projects) {
    queueRemainingWork += Math.max(0, p.workTotal - p.workDone);
    if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE) centreProjects++;
  }
  return {
    poolBase: pool.base,
    poolCentres: pool.centres,
    centreShare: pool.total > 0 ? pool.centres / pool.total : 0,
    centreLevels,
    centreProjects,
    queueRemainingWork,
    queueEtaPulses: pool.total > 0 ? queueRemainingWork / pool.total : null,
  };
}
