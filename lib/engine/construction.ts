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
import { clamp } from "@/lib/utils/math";
import { computeLabourAllocation, labourParts, labourStateFromParts } from "@/lib/engine/industry";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";

/** The per-system fields the pool reads: ownership tier, headcount, and the built base. */
export interface ConstructionPoolSystem {
  control: SystemControl;
  population: number;
  buildings: Record<string, number>;
}

/** Per-pulse point rates. Callers scale both by catchUp when funding (they are pulse incomes). */
export interface ConstructionPoolRates {
  /** Construction points per eligible head per pulse. */
  throughputPerPop: number;
  /** Construction points one fully-staffed Construction Centre level adds per pulse. */
  pointsPerLevel: number;
}

/** A faction's pool, split by source — base (eligible heads) and centre (capital) output. */
export interface ConstructionPool {
  base: number;
  centres: number;
  total: number;
}

/**
 * A faction's per-pulse construction pool over its economically-active (developed) systems.
 *
 * The base is ELIGIBLE heads, not raw headcount: population minus the heads actually employed in
 * technician/engineer jobs (`computeLabourAllocation` — employment-bounded, so a licensed head with
 * no skilled job still builds). An industrialising faction's base erodes as skilled jobs absorb
 * heads; Construction Centres substitute capital for that lost labour, adding
 * `levels × pointsPerLevel × min(labourFulfil, skill1Fulfil)` (the centre's own staffing gate —
 * headcount plus its technician draw). Controlled/unclaimed systems are inert (population 0) and
 * contribute nothing. This remains the single pacing meter: the planner proposes toward physical
 * ceilings; this pool decides how fast fundQueue drains the queue.
 */
export function factionConstructionPool(
  systems: ConstructionPoolSystem[],
  rates: ConstructionPoolRates,
): ConstructionPool {
  let base = 0;
  let centres = 0;
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    const parts = labourParts(s.buildings);
    const alloc = computeLabourAllocation(parts, s.population);
    base += (alloc.unskilled + alloc.unemployed) * rates.throughputPerPop;
    const count = s.buildings[CONSTRUCTION_CENTRE_TYPE] ?? 0;
    if (count > 0) {
      const state = labourStateFromParts(parts, s.population);
      centres += count * rates.pointsPerLevel * Math.min(state.labourFulfil, state.skill1Fulfil);
    }
  }
  return { base, centres, total: base + centres };
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
  /** Total construction points actually consumed this pulse (Σ per-project take). */
  absorbed: number;
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
  let absorbedTotal = 0;

  for (const p of projects) {
    const remaining = Math.max(0, p.workTotal - p.workDone);
    const absorbed = Math.min(safeCap, remaining, poolLeft);
    poolLeft -= absorbed;
    absorbedTotal += absorbed;
    const workDone = p.workDone + absorbed;

    if (workDone >= p.workTotal) {
      landed.push({ ...p, workDone });
    } else {
      open.push({ ...p, workDone });
    }
  }

  return { projects: open, landed, absorbed: absorbedTotal };
}

/**
 * A young colony's guaranteed construction-point floor, self-weaning with development: the full `base`
 * at development 0, fading linearly to 0 once development reaches `knee`. Development is the galaxy-wide
 * magnitude (`systemDevelopment`), so the most-developed systems (homeworlds) reserve nothing and a
 * brand-new colony reserves the most — no colony flag needed. Zero for a non-positive knee.
 */
export function developmentFloorShare(development: number, base: number, knee: number): number {
  if (knee <= 0) return 0;
  return Math.max(0, base) * clamp(1 - Math.max(0, development) / knee, 0, 1);
}

/**
 * Fund a front-first queue with a reserved development-scaled floor for eligible (young-colony) builds,
 * so a colony's valid-but-low-ROI first build isn't monopolised out of the pool by the homeworld's
 * larger builds (docs/planned/economy-colony-bootstrapping.md §3.4 / §7.9). Returns the same shape as
 * `fundQueue`; `reserved = 0` reproduces `fundQueue` exactly.
 *
 * Two passes over the one ROI-ordered queue:
 *  - Pass A funds only the floor-eligible builds, front-first, from `reserved` (the minimum slice).
 *  - Pass B funds the WHOLE queue in ROI order from the general pool — `pool` minus what the reserve
 *    actually spent, so unspent reserve flows back here (no wasted budget) — with each build capped at
 *    `cap` minus its pass-A absorption, so total absorption this pulse never exceeds the per-build cap
 *    (the build-time floor is preserved across both passes).
 * A reserve is a *minimum* slice, never a max-spend cap: an eligible build can still win more from the
 * general pool on ROI, and the homeworld's builds drain whatever the reserve leaves.
 */
export function fundQueueWithFloor(
  ordered: WorldConstructionProject[],
  pool: number,
  cap: number,
  reserved: number,
  isFloorEligible: (p: WorldConstructionProject) => boolean,
): FundQueueResult {
  const safeCap = Number.isFinite(cap) ? Math.max(0, cap) : 0;
  const safePool = Number.isFinite(pool) ? Math.max(0, pool) : 0;
  const cappedReserve = clamp(Number.isFinite(reserved) ? reserved : 0, 0, safePool);

  // Pass A: eligible builds absorb the reserved slice, front-first.
  const absorbed = new Map<string, number>();
  let reserveLeft = cappedReserve;
  let absorbedTotal = 0;
  for (const p of ordered) {
    if (reserveLeft <= 0) break;
    if (!isFloorEligible(p)) continue;
    const remaining = Math.max(0, p.workTotal - p.workDone);
    const take = Math.min(safeCap, remaining, reserveLeft);
    if (take > 0) {
      absorbed.set(p.id, take);
      reserveLeft -= take;
      absorbedTotal += take;
    }
  }

  // Pass B: the whole queue drains the general pool (unspent reserve folded back in), each build capped
  // at its remaining per-pulse absorption.
  let generalLeft = safePool - (cappedReserve - reserveLeft);
  const open: WorldConstructionProject[] = [];
  const landed: WorldConstructionProject[] = [];
  for (const p of ordered) {
    const already = absorbed.get(p.id) ?? 0;
    const remaining = Math.max(0, p.workTotal - p.workDone - already);
    const take = Math.min(Math.max(0, safeCap - already), remaining, generalLeft);
    generalLeft -= take;
    absorbedTotal += take;
    const workDone = p.workDone + already + take;
    if (workDone >= p.workTotal) landed.push({ ...p, workDone });
    else open.push({ ...p, workDone });
  }
  return { projects: open, landed, absorbed: absorbedTotal };
}

/**
 * Funding order over a faction's STORED open set: everything already committed keeps its stored
 * order (front-first — including unfunded auto rows and floor-funded rows the stored order
 * interleaves); fresh player orders (origin "player" with no work yet) move to the back of it,
 * preserving their own insertion (FIFO) order. The caller appends this pulse's new proposals after,
 * so the full priority reads: committed work → player orders → new autonomic proposals. Pure;
 * identity for queues with no fresh player rows.
 */
export function orderOpenProjects(projects: WorldConstructionProject[]): WorldConstructionProject[] {
  const committed: WorldConstructionProject[] = [];
  const freshPlayer: WorldConstructionProject[] = [];
  for (const p of projects) {
    if (p.origin === "player" && p.workDone <= 0) freshPlayer.push(p);
    else committed.push(p);
  }
  return [...committed, ...freshPlayer];
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
  // Exhaustive on `kind` so a future proposal kind can't silently fall into the colony branch and
  // collide tiebreak strings — a new union member fails to compile here until it is given its own label.
  const tiebreak = (p: Proposal): string => {
    switch (p.kind) {
      case "build":
        return `${p.systemId}|${p.items[0]?.buildingType ?? ""}`;
      case "colony_establish":
        return `${p.systemId}|colony`;
      default: {
        const _exhaustive: never = p;
        return _exhaustive;
      }
    }
  };
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

/**
 * Forward-simulate `fundQueue` at a CONSTANT pool + cap to find the pulse each project lands on.
 * Returns an array aligned to `projects` by index: the 1-based pulse count until that project
 * completes, or `null` when it never will at this rate ("stalled" — a zero/invalid pool, or the
 * guard cap hit). Coarse by design: the real pool grows with population and is shared across the
 * queue, so this is an estimate at the current rate, not a countdown. The progress bar
 * (`workDone/workTotal`) is exact; only the ETA is approximate.
 */
export function forecastEtaPulses(
  projects: WorldConstructionProject[],
  pool: number,
  cap: number,
  maxPulses = 999,
): (number | null)[] {
  // A zero/invalid pool funds nothing — everything is stalled (also avoids a maxPulses spin).
  if (!Number.isFinite(pool) || pool <= 0 || !Number.isFinite(cap) || cap <= 0) {
    return projects.map(() => null);
  }
  // Keyed by project id — unique per queue (minted from the world's nextId counter), so each
  // project's landing pulse is recorded once; a duplicate id would overwrite an earlier landing.
  const landedAt = new Map<string, number>();
  let queue = projects.map((p) => ({ ...p }));
  for (let pulse = 1; pulse <= maxPulses && queue.length > 0; pulse++) {
    const { projects: open, landed } = fundQueue(queue, pool, cap);
    for (const l of landed) landedAt.set(l.id, pulse);
    queue = open;
  }
  return projects.map((p) => landedAt.get(p.id) ?? null);
}

/**
 * ETA for several INDEPENDENT single-project hypotheticals that all share one committed queue —
 * as if each were forecast on its own via `forecastEtaPulses([...committed, hypothetical], …)`,
 * without the other hypotheticals competing for the same trailing pool-share (they never actually
 * queue behind one another — each represents its own "what if I ordered just this one" probe).
 *
 * Front-first funding means the committed prefix's own landing schedule never depends on what
 * trails it, so committed funding is simulated ONCE; each hypothetical then draws independently off
 * that shared "pool left after committed" series. This is O(pulses × (committed + hypotheticals))
 * instead of O(hypotheticals × pulses × committed) for calling `forecastEtaPulses` once per
 * hypothetical, and returns identical numbers to that per-call approach.
 */
export function forecastIndependentEtaPulses(
  committed: WorldConstructionProject[],
  hypotheticals: WorldConstructionProject[],
  pool: number,
  cap: number,
  maxPulses = 999,
): (number | null)[] {
  if (!Number.isFinite(pool) || pool <= 0 || !Number.isFinite(cap) || cap <= 0) {
    return hypotheticals.map(() => null);
  }
  let queue = committed.map((p) => ({ ...p }));
  const remaining = hypotheticals.map((h) => Math.max(0, h.workTotal - h.workDone));
  // A hypothetical with no remaining work at all lands on the very first pulse it's considered —
  // matching forecastEtaPulses, which would find it already at workTotal on pulse 1 regardless of
  // how much the committed prefix absorbs first.
  const landedAt: (number | null)[] = remaining.map((r) => (r <= 0 ? 1 : null));

  for (let pulse = 1; pulse <= maxPulses; pulse++) {
    const allHypDone = remaining.every((r) => r <= 0);
    if (queue.length === 0 && allHypDone) break;

    let leftover = pool;
    if (queue.length > 0) {
      // fundQueue doesn't expose its internal leftover pool, so derive it from the work each
      // committed project actually absorbed this pulse (new workDone − old workDone).
      const before = new Map(queue.map((p) => [p.id, p.workDone]));
      const { projects: open, landed } = fundQueue(queue, pool, cap);
      let absorbedByCommitted = 0;
      for (const p of [...open, ...landed]) absorbedByCommitted += p.workDone - (before.get(p.id) ?? p.workDone);
      leftover = pool - absorbedByCommitted;
      queue = open;
    }

    for (let i = 0; i < hypotheticals.length; i++) {
      if (remaining[i] <= 0) continue;
      const take = Math.min(cap, remaining[i], leftover);
      remaining[i] -= take;
      if (remaining[i] <= 0) landedAt[i] = pulse;
    }
  }
  return landedAt;
}
