/**
 * Pure display readout for a faction's committed construction — turns open `constructionProjects`
 * plus the faction's systems into enriched, grouped, ETA-forecast rows. Read-only; the funding math
 * itself lives in `construction.ts`. Two consumers read this: the faction roll-up (whole readout,
 * grouped) and the per-system section (filtered to one system via `all`).
 */
import type {
  SystemControl, WorldColonyEstablishProject, WorldConstructionProject,
} from "@/lib/world/types";
import {
  factionConstructionPool, forecastEtaCycles, fundQueue, type ConstructionPoolRates,
} from "@/lib/engine/construction";
import {
  foundingStagedFraction, nextStagingShare, type FoundingSourceSupply,
} from "@/lib/engine/founding-cost";
import type { ColonyStallReason } from "@/lib/types/colonisation";
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
  /** Coarse ≈cycles to completion at the current rate; null = stalled. */
  etaCycles: number | null;
  /** Construction points this project will absorb on the next funded cycle (0 = starved/"waiting"). Exact for the
   *  immediate next cycle (fundQueue is deterministic); reused for the projected-fill segment + per-row rate. */
  nextCycleGain: number;
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
  /** What this founding is waiting on right now, or null when nothing is. Derived at read time —
   *  the world stores how long a project has been stalled, never why. `awaiting_materials` is
   *  informational: such a project still builds at its normal rate and simply opens with a thinner
   *  endowment, so it is the one reason that leaves `etaCycles` and `nextCycleGain` standing. */
  stalledReason: ColonyStallReason | null;
  /** Share of the seed's manifest already staged and paid for, in [0,1] (value-weighted). */
  stagedFraction: number;
}

/**
 * What the colony rows need from outside the construction queue to say WHY a founding is stuck: the
 * money the founding path actually spends from, and what each colony's source can spare it.
 */
export interface FoundingReadoutInputs {
  /** `balance − pendingFounding` — the working balance the tick commits founding against. */
  workingBalance: number;
  /** Per source system id, what that source can spare this cycle, good by good. */
  supplyBySource: ReadonlyMap<string, ReadonlyArray<FoundingSourceSupply>>;
  /** Cycles of the seed's own consumption a full manifest carries. */
  cover: number;
  /** Consecutive stalled cycles after which a founding writes off the rest of its manifest and
   *  finishes on work alone — past it, nothing is waiting on money or goods any more. */
  writeOffCycles: number;
  /** The quantity→money normaliser the valuation seam divides by. */
  economyScale: number;
}

export type ConstructionProjectRow = ConstructionProjectBuildRow | ConstructionProjectColonyRow;

export interface FactionConstructionReadout {
  /** Total per-cycle funding rate (base + centres) — the value the ETA forecast runs on. */
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
  const ae = a.etaCycles ?? Number.POSITIVE_INFINITY;
  const be = b.etaCycles ?? Number.POSITIVE_INFINITY;
  if (ae !== be) return ae - be;
  return a.systemName.localeCompare(b.systemName);
}

/**
 * Per-project construction points absorbed on the NEXT funded cycle, index-aligned to `projects` — one
 * `fundQueue` step at the current pool + cap. A front project gets its full cap; a project the pool can't reach
 * this cycle gets 0 ("waiting"); a near-complete project gets just its remaining work. The exact same first step
 * the ETA forecast runs, surfaced for display.
 */
export function nextCycleGains(
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
 * What a founding is waiting on right now, or null when nothing is.
 *
 * An unpaid charter binds first and absorbs no work at all. Past that, `stalledCycles` is only ever
 * the world's record that some PAST cycle bought nothing — it resets on a staging draw and nothing
 * else clears it, so a colony that went broke three cycles ago, was refunded, and now merely sits
 * behind higher-ROI builds carries a positive counter for ever (the pool-starvation guard refuses to
 * advance it, but no one retires it). The counter therefore only opens the question; the answer is
 * two LIVE tests against this cycle's share — can the balance pay for what is drawable, and is
 * anything drawable at all. A row that passes both is not waiting on anything, whatever its counter
 * says, and reads null with a finite (possibly distant) ETA.
 *
 * A counter at the write-off threshold is not a stall either, and reads as the opposite of one: the
 * project has given up the rest of its manifest, so nothing gates its work any more and it runs to
 * completion on construction points alone. Its counter stays latched there by construction, so
 * without this it would report a permanent stall for the rest of a build that is actually moving.
 *
 * The two live tests take the optimistic view the processor does not: each colony sees the whole of
 * its source's headroom and the whole working balance, where the tick draws them down in queue order
 * across every colony founding that cycle. It decides a displayed reason, never a debit.
 */
function colonyStallReason(
  p: WorldColonyEstablishProject,
  founding: FoundingReadoutInputs,
  cap: number,
): ColonyStallReason | null {
  if (!p.charterPaid) return "awaiting_charter";
  if (p.stalledCycles <= 0 || p.stalledCycles >= founding.writeOffCycles) return null;
  const plannedWork = Math.min(cap, Math.max(0, p.workTotal - p.workDone));
  const workShare = p.workTotal > 0 ? plannedWork / p.workTotal : 0;
  const share = nextStagingShare(
    founding.supplyBySource.get(p.sourceSystemId) ?? [],
    p.stagedManifest, p.seedPop, workShare, founding.cover, founding.economyScale,
  );
  if (share.drawableValue > founding.workingBalance) return "awaiting_funds";
  if (share.wantValue > 0 && share.drawableValue <= 0) return "awaiting_materials";
  return null;
}

/**
 * Build the faction readout: pool from the developed systems, ETA forecast over the queue as stored
 * (in-flight first — the order the tick funds it), then rows split into Expansion (colonies) and
 * Build-out (builds), each sorted soonest-first. `projects` must be one faction's open projects,
 * and `founding` that faction's money and sources — a colony's progress is priced, not just worked.
 */
export function computeFactionConstruction(
  projects: WorldConstructionProject[],
  systems: ConstructionSystemInfo[],
  rates: ConstructionPoolRates,
  cap: number,
  founding: FoundingReadoutInputs,
): FactionConstructionReadout {
  const nameById = new Map(systems.map((s) => [s.id, s.name]));
  const poolParts = factionConstructionPool(systems, rates);
  const pool = poolParts.total;
  const etas = forecastEtaCycles(projects, pool, cap);
  const gains = nextCycleGains(projects, pool, cap);

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
      etaCycles: etas[i],
      nextCycleGain: gains[i],
    };
    if (p.kind === "colony_establish") {
      const stalledReason = colonyStallReason(p, founding, cap);
      const supply = founding.supplyBySource.get(p.sourceSystemId) ?? [];
      // Only money gates WORK. An unpaid charter absorbs nothing, and a share the balance cannot
      // buy holds the materials ceiling at zero — for both, the pool-derived ETA and rate would
      // promise progress the project cannot make. A source with nothing to spare does not: the
      // achievable-want rule counts what a founder cannot spare as satisfied, so the ceiling stays
      // at the full cap and the colony builds at its normal rate, to open with a thinner endowment.
      const gatesWork = stalledReason === "awaiting_charter" || stalledReason === "awaiting_funds";
      const row: ConstructionProjectColonyRow = {
        ...base,
        etaCycles: gatesWork ? null : base.etaCycles,
        nextCycleGain: gatesWork ? 0 : base.nextCycleGain,
        kind: "colony_establish",
        sourceSystemId: p.sourceSystemId,
        sourceSystemName: nameById.get(p.sourceSystemId) ?? p.sourceSystemId,
        seedPop: p.seedPop,
        housingLevels: p.housingLevels,
        stalledReason,
        stagedFraction: foundingStagedFraction(supply, p.stagedManifest, p.seedPop, founding.cover),
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
