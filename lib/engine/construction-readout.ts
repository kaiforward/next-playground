/**
 * Pure display readout for a faction's committed construction — turns open `constructionProjects`
 * plus the faction's systems into enriched, grouped, ETA-forecast rows. Read-only; the funding math
 * itself lives in `construction.ts`. Two consumers read this: the faction roll-up (whole readout,
 * grouped) and the per-system section (filtered to one system via `all`).
 */
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import {
  factionConstructionPool, forecastEtaPulses, fundQueue, type ConstructionPoolRates,
} from "@/lib/engine/construction";
import { GOODS } from "@/lib/constants/goods";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, CONSTRUCTION_CENTRE_TYPE, COMPLEX_BY_TYPE,
} from "@/lib/constants/industry";

/** The faction-system fields the readout needs: identity (name) + pool inputs (control, population, built base). */
export interface ConstructionSystemInfo {
  id: string;
  name: string;
  control: SystemControl;
  population: number;
  /** Built base — feeds the eligible-heads pool split and centre output. */
  buildings: Record<string, number>;
}

interface ConstructionRowBase {
  id: string;
  systemId: string;
  systemName: string;
  /** Who committed this row: the autonomic planner, or a player order (display + cancel-permission). */
  origin: "auto" | "player";
  /** Exact workDone/workTotal in [0,1]. */
  progress: number;
  workDone: number;
  workTotal: number;
  /** Coarse ≈pulses to completion at the current rate; null = stalled. */
  etaPulses: number | null;
  /** Construction points this project will absorb on the next funded pulse (0 = starved/"waiting"). Exact for the
   *  immediate next pulse (fundQueue is deterministic); reused for the projected-fill segment + per-row rate. */
  nextPulseGain: number;
}

export interface ConstructionProjectBuildRow extends ConstructionRowBase {
  kind: "build";
  /** Raw building-type id — ledger-group classification keys on this, not the label. */
  buildingType: string;
  /** "Housing", "Foundry", "Vocational School", … */
  buildingLabel: string;
  levels: number;
  /** "role · what it unblocks" — static from the building type (the served-demand rationale isn't persisted). */
  detail: string;
}

export interface ConstructionProjectColonyRow extends ConstructionRowBase {
  kind: "colony_establish";
  sourceSystemId: string;
  sourceSystemName: string;
  seedPop: number;
  housingLevels: number;
}

export type ConstructionProjectRow = ConstructionProjectBuildRow | ConstructionProjectColonyRow;

export interface FactionConstructionReadout {
  /** Total per-pulse funding rate (base + centres) — the value the ETA forecast runs on. */
  pool: number;
  /** Eligible-heads component of the pool (population not employed in skilled work). */
  poolBase: number;
  /** Construction Centre component of the pool (capital-generated points). */
  poolCentres: number;
  expandCount: number;
  buildCount: number;
  /** colony_establish rows, soonest-ETA first (stalled last). */
  expansion: ConstructionProjectColonyRow[];
  /** build rows, soonest-ETA first (stalled last). */
  buildOut: ConstructionProjectBuildRow[];
  /** Every row in queue order — the per-system section filters this by systemId. */
  all: ConstructionProjectRow[];
}

/** Human label for a build project's building type (mirrors the industry panel's `label`). */
export function buildingLabel(buildingType: string): string {
  if (buildingType === HOUSING_TYPE) return "Housing";
  if (buildingType === VOCATIONAL_SCHOOL_TYPE) return "Vocational School";
  if (buildingType === RESEARCH_INSTITUTE_TYPE) return "Research Institute";
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "Construction Centre";
  return COMPLEX_BY_TYPE[buildingType]?.label ?? GOODS[buildingType]?.name ?? buildingType;
}

/** "role · what it unblocks" for a build row, keyed by building type (not the live deficit — that isn't stored). */
export function describeBuildProject(buildingType: string): string {
  if (buildingType === HOUSING_TYPE) return "housing · adds population capacity";
  if (buildingType === VOCATIONAL_SCHOOL_TYPE) return "workforce · licenses technician-grade work";
  if (buildingType === RESEARCH_INSTITUTE_TYPE) return "workforce · licenses engineer-grade work";
  if (buildingType === CONSTRUCTION_CENTRE_TYPE) return "construction · adds faction build throughput";
  const complex = COMPLEX_BY_TYPE[buildingType];
  if (complex) return `specialisation · anchors ${complex.label} yield`;
  return `industry · produces ${GOODS[buildingType]?.name ?? buildingType}`;
}

function progressOf(p: WorldConstructionProject): number {
  return p.workTotal > 0 ? Math.min(1, Math.max(0, p.workDone / p.workTotal)) : 0;
}

/** Soonest-ETA first; stalled (null) last; ties by system name — a total, deterministic order. */
function byEta(a: ConstructionRowBase, b: ConstructionRowBase): number {
  const ae = a.etaPulses ?? Number.POSITIVE_INFINITY;
  const be = b.etaPulses ?? Number.POSITIVE_INFINITY;
  if (ae !== be) return ae - be;
  return a.systemName.localeCompare(b.systemName);
}

/**
 * Per-project construction points absorbed on the NEXT funded pulse, index-aligned to `projects` — one
 * `fundQueue` step at the current pool + cap. A front project gets its full cap; a project the pool can't reach
 * this pulse gets 0 ("waiting"); a near-complete project gets just its remaining work. The exact same first step
 * the ETA forecast runs, surfaced for display.
 */
export function nextPulseGains(
  projects: WorldConstructionProject[],
  pool: number,
  cap: number,
): number[] {
  const { projects: open, landed } = fundQueue(projects, pool, cap);
  // Keyed by project id — unique per queue (minted from the world's nextId counter), so each project
  // reads back its own post-step workDone; a duplicate id would cross-wire two projects' gains.
  const doneById = new Map<string, number>();
  for (const p of open) doneById.set(p.id, p.workDone);
  for (const p of landed) doneById.set(p.id, p.workDone);
  return projects.map((p) => Math.max(0, (doneById.get(p.id) ?? p.workDone) - p.workDone));
}

/**
 * Build the faction readout: pool from the developed systems, ETA forecast over the queue as stored
 * (in-flight first — the order the tick funds it), then rows split into Expansion (colonies) and
 * Build-out (builds), each sorted soonest-first. `projects` must be one faction's open projects.
 */
export function computeFactionConstruction(
  projects: WorldConstructionProject[],
  systems: ConstructionSystemInfo[],
  rates: ConstructionPoolRates,
  cap: number,
): FactionConstructionReadout {
  const nameById = new Map(systems.map((s) => [s.id, s.name]));
  const poolParts = factionConstructionPool(systems, rates);
  const pool = poolParts.total;
  const etas = forecastEtaPulses(projects, pool, cap);
  const gains = nextPulseGains(projects, pool, cap);

  const all: ConstructionProjectRow[] = [];
  const expansion: ConstructionProjectColonyRow[] = [];
  const buildOut: ConstructionProjectBuildRow[] = [];

  projects.forEach((p, i) => {
    const base: ConstructionRowBase = {
      id: p.id,
      systemId: p.systemId,
      systemName: nameById.get(p.systemId) ?? p.systemId,
      origin: p.origin,
      progress: progressOf(p),
      workDone: p.workDone,
      workTotal: p.workTotal,
      etaPulses: etas[i],
      nextPulseGain: gains[i],
    };
    if (p.kind === "colony_establish") {
      const row: ConstructionProjectColonyRow = {
        ...base,
        kind: "colony_establish",
        sourceSystemId: p.sourceSystemId,
        sourceSystemName: nameById.get(p.sourceSystemId) ?? p.sourceSystemId,
        seedPop: p.seedPop,
        housingLevels: p.housingLevels,
      };
      all.push(row);
      expansion.push(row);
    } else {
      const row: ConstructionProjectBuildRow = {
        ...base,
        kind: "build",
        buildingType: p.buildingType,
        buildingLabel: buildingLabel(p.buildingType),
        levels: p.levels,
        detail: describeBuildProject(p.buildingType),
      };
      all.push(row);
      buildOut.push(row);
    }
  });

  expansion.sort(byEta);
  buildOut.sort(byEta);

  return {
    pool, poolBase: poolParts.base, poolCentres: poolParts.centres,
    expandCount: expansion.length, buildCount: buildOut.length, expansion, buildOut, all,
  };
}
