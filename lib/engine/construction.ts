/**
 * Pure committed-construction math — zero DB dependency.
 *
 * Capacity grows only through construction projects funded from a per-faction throughput pool. This
 * module owns the funding half: `fundQueue` chews a front-first queue with a per-build absorption cap,
 * landing whole levels when their work completes. The planning half (which projects to enqueue toward
 * the physical ceilings) lives in `lib/engine/directed-build.ts`.
 */
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import type { Proposal } from "@/lib/engine/directed-build";
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

export interface FundQueueResult {
  /** Still-open projects with advanced workDone (landed projects removed). Same order as the input. */
  projects: WorldConstructionProject[];
  /**
   * Projects that COMPLETED this pulse (workDone reached workTotal), in the order they landed — full
   * discriminated rows, so the caller applies each by its `kind` (a build increments counts; a
   * colony-establish develops + seeds + houses). fundQueue stays decision-free: it moves rows between
   * open and landed by work alone, never interpreting the kind.
   */
  landed: WorldConstructionProject[];
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
  const landed: WorldConstructionProject[] = [];

  for (const p of projects) {
    const remaining = Math.max(0, p.workTotal - p.workDone);
    const absorbed = Math.min(safeCap, remaining, poolLeft);
    poolLeft -= absorbed;
    const workDone = p.workDone + absorbed;

    if (workDone >= p.workTotal) {
      landed.push({ ...p, workDone });
    } else {
      open.push({ ...p, workDone });
    }
  }

  return { projects: open, landed };
}

/** ROI of a proposal on the shared construction pool: served value ÷ whole-bundle work (0 if no work). */
export function proposalRoi(p: Proposal): number {
  return p.work > 0 ? p.value / p.work : 0;
}

/** Housing leads population — the proactive substrate funds ahead of ROI-ranked opportunities. */
function isHousing(p: Proposal): boolean {
  return p.kind === "build" && p.role === "housing";
}

/**
 * Order this pulse's new proposals into funding priority (front = funded first) — the reorder of
 * `fundQueue`'s input the value-order model prescribes (docs/planned/economy-colonisation-cost.md §4):
 *   1. housing — the proactive population substrate leads (no served-demand ROI of its own);
 *   2. everything else by descending ROI (value ÷ whole-bundle work).
 * Ties break by systemId then first-item type, a total order independent of input order (determinism).
 * A proposal is atomic — its gate-first `items` are never split, so a bundled academy stays ahead of
 * the production it gates. The caller expands each proposal into its item rows and prepends the
 * in-flight projects (already-committed work finishes first); `fundQueue` then drains front-first.
 * Pure: sorts a copy, never mutates the input.
 */
export function orderProposals(proposals: Proposal[]): Proposal[] {
  const tiebreak = (p: Proposal): string => `${p.systemId}|${p.items[0]?.buildingType ?? ""}`;
  return [...proposals].sort((a, b) => {
    const ah = isHousing(a);
    const bh = isHousing(b);
    if (ah !== bh) return ah ? -1 : 1; // housing first
    if (!ah) {
      const dRoi = proposalRoi(b) - proposalRoi(a); // then descending ROI
      if (Math.abs(dRoi) > 1e-12) return dRoi;
    }
    return tiebreak(a).localeCompare(tiebreak(b)); // deterministic within a tier / ROI tie
  });
}
