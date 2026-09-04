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
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";

/** The per-system fields the pool reads: ownership tier, headcount, and the built base. */
export interface ConstructionPoolSystem {
  control: SystemControl;
  population: number;
  buildings: Record<string, number>;
}

/** Per-cycle point rates. Callers scale both by catchUp when funding (they are cycle incomes). */
export interface ConstructionPoolRates {
  /** Construction points per eligible head per cycle. */
  throughputPerPop: number;
  /** Construction points one fully-staffed Construction Centre level adds per cycle. */
  pointsPerLevel: number;
}

/** A faction's pool, split by source — base (eligible heads) and centre (capital) output. */
export interface ConstructionPool {
  base: number;
  centres: number;
  total: number;
}

/**
 * A faction's per-cycle construction pool over its economically-active (developed) systems.
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
   * Projects that landed a level this cycle, in the order they landed — full discriminated rows, so
   * the caller applies each by its `kind` (a build increments counts by `levels`; a colony-establish
   * develops + seeds + houses). A `kind: "build"` row lands EITHER on full completion (workDone
   * reaches workTotal) OR incrementally, the moment its workDone crosses a `workTotal ÷ levels`
   * boundary: such a row SPLITS into a landed part (the whole levels just reached, its own
   * workTotal/workDone shrunk to match) and an open remainder carrying the SAME id with the rest of
   * the work — so a caller keying off id must expect up to one landed row and one open row sharing an
   * id in the same result, and must sum across both to recover a project's total absorbed work this
   * cycle. `colony_establish` rows never split — they land only whole, on full completion. A `kind:
   * "lane_upgrade"` row splits exactly like a `build` row: both carry `levels`, and the split is keyed
   * on that shape, not on the kind. fundQueue stays decision-free otherwise: it moves rows between
   * open and landed by work alone, never interpreting the kind.
   */
  landed: WorldConstructionProject[];
  /** Total construction points actually consumed this cycle (Σ per-project take). */
  absorbed: number;
}

/**
 * Split a row with `levels` (a `kind: "build"` or `kind: "lane_upgrade"` row) that absorbed work this
 * cycle but did not complete, into a landed part carrying the whole levels its workDone now covers and
 * an open remainder — same id — carrying the rest. `perLevelWork = workTotal ÷ levels` is invariant
 * across repeated splits (both shrink by the same amount each time a level lands), so it can be
 * recomputed from whatever the row currently carries. `k = floor(workDone ÷ perLevelWork)` uses a
 * small tolerance on the ratio so a workDone that lands exactly on a level boundary, up to float
 * error, still counts that level rather than rounding down and stranding it a cycle. `k` is capped at
 * `levels − 1`: this is only ever called on a row already known not to have completed (workDone <
 * workTotal), so a remainder always survives — this also keeps a single-level project from ever
 * splitting (levels − 1 = 0), matching its old lands-whole-or-not-at-all behaviour. Returns null when
 * nothing lands (`colony_establish` rows, which never split, or `k <= 0`) — the caller keeps such a
 * row on its own open/landed decision unchanged.
 *
 * The remainder's workDone is floored at 0: when the tolerance rounds a just-short workDone UP to a
 * boundary, the landed part claims a hair more work than was actually paid for, which would otherwise
 * leave the remainder holding a negative epsilon.
 */
function splitLandedLevels(
  p: WorldConstructionProject,
): { landed: WorldConstructionProject; open: WorldConstructionProject } | null {
  if (p.kind === "colony_establish") return null;
  const perLevelWork = p.levels > 0 ? p.workTotal / p.levels : 0;
  if (!(perLevelWork > 0)) return null;
  const ratio = p.workDone / perLevelWork;
  const rounded = Math.round(ratio);
  const raw = Math.abs(ratio - rounded) < 1e-9 ? rounded : Math.floor(ratio);
  const k = Math.min(Math.max(0, raw), p.levels - 1);
  if (k <= 0) return null;
  const landedWork = k * perLevelWork;
  return {
    landed: { ...p, levels: k, workTotal: landedWork, workDone: landedWork },
    open: {
      ...p,
      levels: p.levels - k,
      workTotal: p.workTotal - landedWork,
      workDone: Math.max(0, p.workDone - landedWork),
    },
  };
}

/** Land a stepped project (post-absorption workDone already applied) onto the open/landed split,
 *  splitting a build row that crossed a level boundary without completing. Shared by `fundQueue` and
 *  `fundQueueWithFloor`'s pass-B landing so the tick and every forecast agree on when a level lands. */
function settleProject(
  p: WorldConstructionProject,
  open: WorldConstructionProject[],
  landed: WorldConstructionProject[],
): void {
  if (p.workDone >= p.workTotal) {
    landed.push(p);
    return;
  }
  const split = splitLandedLevels(p);
  if (split) {
    landed.push(split.landed);
    open.push(split.open);
  } else {
    open.push(p);
  }
}

/**
 * Fund a front-first construction queue for one cycle.
 *
 * `pool` construction points are handed to projects in order; each active build absorbs
 * `min(cap, its remaining work, pool left)` — the per-build cap sets a minimum build time
 * (`workTotal ÷ cap` cycles) that extra pool cannot bypass, and leftover pool cascades to the next
 * build so a large pool spreads across parallel fronts. A project whose accumulated work reaches its
 * total lands its whole `levels`; a `kind: "build"` row that crosses a level boundary without
 * completing lands that level and keeps the rest open under the same id (see `FundQueueResult.landed`).
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
    settleProject({ ...p, workDone }, open, landed);
  }

  return { projects: open, landed, absorbed: absorbedTotal };
}

/**
 * A per-project absorption ceiling: the seam through which a caller that knows something the queue
 * cannot (whether a colony's materials can be bought this cycle) tightens ONE project's cap. It can
 * only ever lower — a ceiling above `cap` clamps back to it.
 */
export type ProjectCap = (p: WorldConstructionProject) => number;

/**
 * One cycle of front-first funding under an optional per-project ceiling — the funding step both
 * forecasts run, so a forecast drains the queue exactly the way the tick's own
 * `fundQueueWithFloor` does. No floor is reserved: a forecast is a rate estimate, and the reserve is
 * a within-cycle reordering that never changes how much the pool funds in total.
 */
export function fundCycle(
  projects: WorldConstructionProject[],
  pool: number,
  cap: number,
  capFor?: ProjectCap,
): FundQueueResult {
  return capFor === undefined
    ? fundQueue(projects, pool, cap)
    : fundQueueWithFloor(projects, pool, cap, 0, () => false, capFor);
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
 * larger builds. Returns the same shape as `fundQueue`; `reserved = 0` reproduces `fundQueue` exactly.
 *
 * Two passes over the one ROI-ordered queue:
 *  - Pass A funds only the floor-eligible builds, front-first, from `reserved` (the minimum slice).
 *  - Pass B funds the WHOLE queue in ROI order from the general pool — `pool` minus what the reserve
 *    actually spent, so unspent reserve flows back here (no wasted budget) — with each build capped at
 *    `cap` minus its pass-A absorption, so total absorption this cycle never exceeds the per-build cap
 *    (the build-time floor is preserved across both passes).
 * A reserve is a *minimum* slice, never a max-spend cap: an eligible build can still win more from the
 * general pool on ROI, and the homeworld's builds drain whatever the reserve leaves.
 *
 * `capFor` lowers the scalar `cap` for one project — the seam through which a caller that knows
 * something this function cannot (whether a colony's materials can be bought this cycle) tightens a
 * single project's ceiling without giving the queue market or treasury access. It binds in BOTH
 * passes, so a ceiling of 0 cannot be routed around by the reserved floor, and it can only ever
 * lower: a callback returning more than `cap` is clamped back to it, so the minimum build time
 * (`workTotal ÷ cap` cycles) stays a property no caller can buy its way past. Omitted → every
 * project takes the scalar `cap`, exactly today's behaviour.
 */
export function fundQueueWithFloor(
  ordered: WorldConstructionProject[],
  pool: number,
  cap: number,
  reserved: number,
  isFloorEligible: (p: WorldConstructionProject) => boolean,
  capFor?: ProjectCap,
): FundQueueResult {
  const safeCap = Number.isFinite(cap) ? Math.max(0, cap) : 0;
  const safePool = Number.isFinite(pool) ? Math.max(0, pool) : 0;
  const cappedReserve = clamp(Number.isFinite(reserved) ? reserved : 0, 0, safePool);

  // Resolved once per project so both passes see one ceiling even if the callback is not pure.
  const ceilings = new Map<string, number>();
  const ceilingFor = (p: WorldConstructionProject): number => {
    const cached = ceilings.get(p.id);
    if (cached !== undefined) return cached;
    const raw = capFor === undefined ? safeCap : capFor(p);
    const resolved = Number.isFinite(raw) ? clamp(raw, 0, safeCap) : 0;
    ceilings.set(p.id, resolved);
    return resolved;
  };

  // Pass A: eligible builds absorb the reserved slice, front-first.
  const absorbed = new Map<string, number>();
  let reserveLeft = cappedReserve;
  let absorbedTotal = 0;
  for (const p of ordered) {
    if (reserveLeft <= 0) break;
    if (!isFloorEligible(p)) continue;
    const remaining = Math.max(0, p.workTotal - p.workDone);
    const take = Math.min(ceilingFor(p), remaining, reserveLeft);
    if (take > 0) {
      absorbed.set(p.id, take);
      reserveLeft -= take;
      absorbedTotal += take;
    }
  }

  // Pass B: the whole queue drains the general pool (unspent reserve folded back in), each build capped
  // at its remaining per-cycle absorption.
  let generalLeft = safePool - (cappedReserve - reserveLeft);
  const open: WorldConstructionProject[] = [];
  const landed: WorldConstructionProject[] = [];
  for (const p of ordered) {
    const already = absorbed.get(p.id) ?? 0;
    const remaining = Math.max(0, p.workTotal - p.workDone - already);
    const take = Math.min(Math.max(0, ceilingFor(p) - already), remaining, generalLeft);
    generalLeft -= take;
    absorbedTotal += take;
    const workDone = p.workDone + already + take;
    settleProject({ ...p, workDone }, open, landed);
  }
  return { projects: open, landed, absorbed: absorbedTotal };
}

/**
 * Funding order over a faction's STORED open set: everything already committed keeps its stored
 * order (front-first — including unfunded auto rows and floor-funded rows the stored order
 * interleaves); fresh player orders (origin "player" with no work yet) move to the back of it,
 * preserving their own insertion (FIFO) order. The caller appends this cycle's new proposals after,
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
 * A build proposal whose production serves a survival good (water, food — `SURVIVAL_GOODS`). Reads
 * `producedGood` — the field the industry bundle carries from the good it was built for — never
 * `items[0]`, whose gate-first order (academy/complex before production) puts the produced good LAST,
 * not first. A colony or construction-centre proposal carries no `producedGood` and so is never
 * survival-serving.
 */
function isSurvivalBuild(p: Proposal): boolean {
  return p.kind === "build" && p.producedGood !== undefined && SURVIVAL_GOODS.includes(p.producedGood);
}

/**
 * Order this cycle's new proposals into funding priority (front = funded first) — the reorder of
 * `fundQueue`'s input the value-order model prescribes (docs/active/gameplay/colonisation.md):
 *   1. housing — the proactive population substrate leads (no served-demand ROI of its own);
 *   2. survival-serving industry (water, food) by descending ROI;
 *   3. everything else (industry, colonies, centres, lane upgrades) by descending ROI.
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
      case "lane_upgrade":
        return `${p.laneKey}|lane`;
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
      const asurv = isSurvivalBuild(a);
      const bsurv = isSurvivalBuild(b);
      if (asurv !== bsurv) return asurv ? -1 : 1; // survival-serving industry next
      const dRoi = proposalRoi(b) - proposalRoi(a); // then descending ROI within the band
      if (Math.abs(dRoi) > 1e-12) return dRoi;
    }
    return tiebreak(a).localeCompare(tiebreak(b)); // deterministic within a tier / ROI tie
  });
}

/** A pool or per-project cap that is zero, negative or non-finite funds nothing — everything stalls. */
function fundsNothing(pool: number, cap: number): boolean {
  return !Number.isFinite(pool) || pool <= 0 || !Number.isFinite(cap) || cap <= 0;
}

/**
 * Forward-simulate `fundQueue` at a CONSTANT pool + cap to find the cycle each project lands on.
 * Returns an array aligned to `projects` by index: the 1-based cycle count until that project
 * completes, or `null` when it never will at this rate ("stalled" — a zero/invalid pool, or the
 * guard cap hit). Coarse by design: the real pool grows with population and is shared across the
 * queue, so this is an estimate at the current rate, not a countdown. The progress bar
 * (`workDone` over the row's work unit) is exact; only the ETA is approximate.
 *
 * A `kind: "build"` project that lands levels incrementally records `landedAt` only on the FIRST
 * cycle one of its levels lands — `etaCycles` means the cycle the NEXT level completes, matching
 * what the progress bar and next-cycle-gain readout both describe (the building currently being
 * worked on, not the whole multi-level order). A project that only ever lands once is unaffected:
 * its first landing is its only one.
 */
export function forecastEtaCycles(
  projects: WorldConstructionProject[],
  pool: number,
  cap: number,
  maxCycles = 9999,
  capFor?: ProjectCap,
): (number | null)[] {
  // Everything is stalled (this also avoids a maxCycles spin).
  if (fundsNothing(pool, cap)) {
    return projects.map(() => null);
  }
  // Keyed by project id — unique per queue (minted from the world's nextId counter), so each
  // project's landing cycle is recorded once; a duplicate id would overwrite an earlier landing.
  const landedAt = new Map<string, number>();
  let queue = projects.map((p) => ({ ...p }));
  for (let cycle = 1; cycle <= maxCycles && queue.length > 0; cycle++) {
    const { projects: open, landed } = fundCycle(queue, pool, cap, capFor);
    for (const l of landed) if (!landedAt.has(l.id)) landedAt.set(l.id, cycle);
    queue = open;
  }
  return projects.map((p) => landedAt.get(p.id) ?? null);
}

/**
 * ETA for several INDEPENDENT single-project hypotheticals that all share one committed queue —
 * as if each were forecast on its own via `forecastEtaCycles([...committed, hypothetical], …)`,
 * without the other hypotheticals competing for the same trailing pool-share (they never actually
 * queue behind one another — each represents its own "what if I ordered just this one" probe).
 *
 * Front-first funding means the committed prefix's own landing schedule never depends on what
 * trails it, so committed funding is simulated ONCE; each hypothetical then draws independently off
 * that shared "pool left after committed" series. This is O(cycles × (committed + hypotheticals))
 * instead of O(hypotheticals × cycles × committed) for calling `forecastEtaCycles` once per
 * hypothetical, and returns identical numbers to that per-call approach.
 */
export function forecastIndependentEtaCycles(
  committed: WorldConstructionProject[],
  hypotheticals: WorldConstructionProject[],
  pool: number,
  cap: number,
  maxCycles = 9999,
  capFor?: ProjectCap,
): (number | null)[] {
  if (fundsNothing(pool, cap)) {
    return hypotheticals.map(() => null);
  }
  let queue = committed.map((p) => ({ ...p }));
  const remaining = hypotheticals.map((h) => Math.max(0, h.workTotal - h.workDone));
  // A hypothetical with no remaining work at all lands on the very first cycle it's considered —
  // matching forecastEtaCycles, which would find it already at workTotal on cycle 1 regardless of
  // how much the committed prefix absorbs first.
  const landedAt: (number | null)[] = remaining.map((r) => (r <= 0 ? 1 : null));

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    // The committed prefix is simulated only to produce the leftover each hypothetical draws on, so
    // once every hypothetical has landed there is nothing further to compute — including when a
    // ceilinged committed row (a colony whose materials it cannot buy) would never land at all.
    if (remaining.every((r) => r <= 0)) break;

    let leftover = pool;
    if (queue.length > 0) {
      // fundQueue doesn't expose its internal leftover pool, so derive it from the work each
      // committed project actually absorbed this cycle (new workDone − old workDone). A split build
      // row leaves its landed part and open remainder sharing one id in [open, landed] — sum each
      // id's post-step workDone across every row bearing it FIRST, then subtract that id's single
      // pre-step workDone once, or a split id would have its prior workDone subtracted twice.
      const before = new Map(queue.map((p) => [p.id, p.workDone]));
      const { projects: open, landed } = fundCycle(queue, pool, cap, capFor);
      const totalDoneById = new Map<string, number>();
      for (const p of [...open, ...landed]) {
        totalDoneById.set(p.id, (totalDoneById.get(p.id) ?? 0) + p.workDone);
      }
      let absorbedByCommitted = 0;
      for (const [id, totalDone] of totalDoneById) absorbedByCommitted += totalDone - (before.get(id) ?? totalDone);
      leftover = pool - absorbedByCommitted;
      queue = open;
    }

    for (let i = 0; i < hypotheticals.length; i++) {
      if (remaining[i] <= 0) continue;
      const take = Math.min(cap, remaining[i], leftover);
      remaining[i] -= take;
      if (remaining[i] <= 0) landedAt[i] = cycle;
    }
  }
  return landedAt;
}
