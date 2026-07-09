/**
 * Pure committed-construction math — zero DB dependency.
 *
 * Capacity grows only through construction projects funded from a per-faction throughput pool. This
 * module owns the funding half: `fundQueue` chews a front-first queue with a per-build absorption cap,
 * landing whole levels when their work completes. The planning half (which projects to enqueue toward
 * the physical ceilings) lives in `lib/engine/directed-build.ts`.
 */
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import { isEconomicallyActive } from "@/lib/engine/control";

/**
 * A faction's per-pulse construction throughput pool: Σ over its economically-active (developed)
 * systems of population × throughputPerPop. Controlled/unclaimed systems are inert (population 0)
 * and contribute nothing. This is the single pacing meter — the planner proposes toward physical
 * ceilings; this pool decides how fast fundQueue drains the queue. A money/treasury gate stacks on
 * top of this at the same seam later (docs/planned/economy-demand-driven-model.md §5).
 */
export function factionThroughputPool(
  systems: Array<{ control: SystemControl; population: number }>,
  throughputPerPop: number,
): number {
  let pool = 0;
  for (const s of systems) {
    if (isEconomicallyActive(s.control)) pool += Math.max(0, s.population) * throughputPerPop;
  }
  return pool;
}

/** One completed project's whole-level payload — applied as an integer count increment. */
export interface LandedLevel {
  systemId: string;
  buildingType: string;
  levels: number;
}

export interface FundQueueResult {
  /** Still-open projects with advanced workDone (landed projects removed). Same order as the input. */
  projects: WorldConstructionProject[];
  /** Projects that completed this pulse, in the order they landed. */
  landed: LandedLevel[];
}

/**
 * Fund a front-first construction queue for one pulse.
 *
 * `pool` construction points are handed to projects in order; each active build absorbs
 * `min(cap, its remaining work, pool left)` — the per-build cap sets a minimum build time
 * (`workTotal ÷ cap` pulses) that extra pool cannot bypass, and leftover pool cascades to the next
 * build so a large pool spreads across parallel fronts. A project whose accumulated work reaches its
 * total lands its whole `levels` and drops out of the returned queue.
 *
 * Pure and deterministic: returns fresh project rows, never mutates the inputs.
 */
export function fundQueue(
  projects: WorldConstructionProject[],
  pool: number,
  cap: number,
): FundQueueResult {
  // Coerce funding inputs to finite: a non-finite pool/cap (e.g. an upstream NaN population) would
  // flow through Math.min into workDone and land NaN in World state, which JSON.stringify turns to
  // null on save.
  const safeCap = Number.isFinite(cap) ? Math.max(0, cap) : 0;
  let poolLeft = Number.isFinite(pool) ? Math.max(0, pool) : 0;
  const open: WorldConstructionProject[] = [];
  const landed: LandedLevel[] = [];

  for (const p of projects) {
    const remaining = Math.max(0, p.workTotal - p.workDone);
    const absorbed = Math.min(safeCap, remaining, poolLeft);
    poolLeft -= absorbed;
    const workDone = p.workDone + absorbed;

    if (workDone >= p.workTotal) {
      landed.push({ systemId: p.systemId, buildingType: p.buildingType, levels: p.levels });
    } else {
      open.push({ ...p, workDone });
    }
  }

  return { projects: open, landed };
}
