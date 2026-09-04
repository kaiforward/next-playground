/**
 * Pure lane engine — the shared substrate routing and investment mechanics build on
 * (docs/planned/logistics-lanes.md §1). Zero I/O, no world reads: callers pass in exactly the rows
 * this module needs.
 */

import type { SystemControl, WorldLane } from "@/lib/world/types";
import { LANES } from "@/lib/constants/lanes";

/**
 * Canonical undirected pair key — the sorted `"a|b"` pair, identical in shape to `buildOpenEdges`'s
 * own dedup key (`lib/tick/world/trade-flow-topology.ts`) so a lane and its open-edge view always
 * agree on identity. Order-independent: `laneKey(a, b) === laneKey(b, a)`.
 */
export function laneKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Recover a lane's two endpoint system ids from its `laneKey` — the inverse of `laneKey` itself,
 * shared so no caller splits the `"a|b"` convention inline (`dropAbandonedBuildProjects`,
 * `lib/world/tick.ts`, is the first of several).
 */
export function laneEndpoints(key: string): [string, string] {
  const [a, b] = key.split("|");
  return [a, b];
}

/** One lane's whole-level credit from a landed `lane_upgrade` construction project. */
export interface LaneLevelIncrease {
  key: string;
  levels: number;
}

/**
 * Fold landed `lane_upgrade` construction levels onto their lanes' `level` — the lane analogue of
 * `applyBuildingIncreases` (`lib/world/tick.ts`). Pure; returns fresh rows only for lanes an increase
 * actually touches, an identity copy of `lanes` when there is nothing to fold.
 */
export function applyLaneLevelIncreases(
  lanes: readonly WorldLane[],
  increases: readonly LaneLevelIncrease[],
): WorldLane[] {
  if (increases.length === 0) return [...lanes];
  const byKey = new Map<string, number>();
  for (const inc of increases) byKey.set(inc.key, (byKey.get(inc.key) ?? 0) + inc.levels);
  return lanes.map((lane) => {
    const add = byKey.get(lane.key);
    return add ? { ...lane, level: lane.level + add } : lane;
  });
}

/**
 * Capacity at `level` — linear first cut, verbatim from the spec (§1): baseline at level 0, rising
 * by one baseline unit of capacity per level.
 */
export function laneCapacity(level: number): number {
  return LANES.BASE_LANE_CAPACITY * (1 + level);
}

/** The endpoint-ownership shape `laneInvestor` needs — deliberately narrower than `WorldSystem` so
 *  callers don't have to construct one just to check investability. */
export interface LaneEndpointOwner {
  factionId: string | null;
  control: SystemControl;
}

/** Ordinal rank over `SystemControl` so "at least controlled" is a numeric comparison rather than a
 *  repeated `=== "controlled" || === "developed"`. */
const CONTROL_RANK: Record<SystemControl, number> = {
  unclaimed: 0,
  controlled: 1,
  developed: 2,
};

/**
 * The faction that may invest in `lane` — the faction controlling BOTH endpoint systems, each at
 * `control` rank at least `controlled` (spec §1: "a faction may invest in a lane exactly when it
 * controls both endpoint systems … control ≥ controlled"). Null when either endpoint is unclaimed,
 * the endpoints belong to different factions, or either endpoint's control is below `controlled` —
 * a lane with an unclaimed endpoint is deliberately pinned at baseline capacity (§1).
 */
export function laneInvestor(
  lane: Pick<WorldLane, "aId" | "bId">,
  ownerOf: (systemId: string) => LaneEndpointOwner,
): string | null {
  const a = ownerOf(lane.aId);
  const b = ownerOf(lane.bId);
  if (a.factionId === null || b.factionId === null) return null;
  if (a.factionId !== b.factionId) return null;
  if (CONTROL_RANK[a.control] < CONTROL_RANK.controlled) return null;
  if (CONTROL_RANK[b.control] < CONTROL_RANK.controlled) return null;
  return a.factionId;
}

/**
 * Construction work owed per investing faction this settlement — Σ `level × UPGRADE_WORK_PER_LEVEL`
 * over every lane the faction is the investor of (docs/planned/logistics-lanes.md §1: "build and
 * upkeep ride the existing purse"). A lane with no investor (either endpoint unclaimed, split
 * between factions, or below `controlled`) contributes to nobody's bill — it still decays (see
 * `decayLanes`), it just costs nothing to leave alone. Level-0 lanes are skipped outright: they carry
 * no invested capacity, so they owe no upkeep even when both endpoints qualify a faction as investor.
 */
export function laneUpkeepWork(
  lanes: readonly WorldLane[],
  ownerOf: (systemId: string) => LaneEndpointOwner,
): ReadonlyMap<string, number> {
  const work = new Map<string, number>();
  for (const lane of lanes) {
    if (lane.level <= 0) continue;
    const investor = laneInvestor(lane, ownerOf);
    if (investor === null) continue;
    work.set(investor, (work.get(investor) ?? 0) + lane.level * LANES.UPGRADE_WORK_PER_LEVEL);
  }
  return work;
}

export interface LaneDecayParams {
  /** Reference cycles a lane's whole marginal level must sit fully unused before it sheds one level —
   *  the lane analogue of `DecayParams.idleBufferCycles` (`lib/engine/infrastructure-decay.ts`). */
  idleBufferCycles: number;
}

export interface LaneDecayResult {
  lanes: WorldLane[];
  /** Lane keys that shed a level this run (empty on a run that sheds nothing). */
  shed: string[];
}

/**
 * Whole-level lane decay — the lane analogue of `computeSystemDecay`'s idle-contraction channel
 * (`lib/engine/infrastructure-decay.ts`, mirrored literally): a per-lane countdown accrues `catchUp`
 * reference-cycles while a whole level's worth of capacity goes unused, resets the moment a run uses
 * it, and at the buffer sheds exactly one level (never below 0) and restarts the countdown.
 *
 * "Attempted load" is this run's `bookedLoad + blockedVolume` (docs/planned/logistics-lanes.md §1: a
 * congested run that turned volume away still counts as use). Both figures are booked by the
 * logistics processor already scaled by that run's `catchUp`, so the capacity this compares against
 * must be scaled the same way: `laneCapacity(level) × catchUp` for the compare, and `BASE_LANE_CAPACITY
 * × catchUp` (one level's worth) for "a whole level unused" — comparing a catchUp-scaled attempt
 * against unscaled capacity would over- or under-count idleness whenever the logistics cadence
 * differs from the reference cycle.
 *
 * A lane at level 0 has no marginal level to measure idleness against, so it never accrues and never
 * decays further. Investment plays no part in whether a lane decays: an investor-less lane above
 * level 0 (nobody currently qualifies, or the investor abandoned it) still erodes on the same clock —
 * nobody pays for it, but nobody needs to for it to decay.
 */
export function decayLanes(
  lanes: readonly WorldLane[],
  catchUp: number,
  params: LaneDecayParams,
): LaneDecayResult {
  const safeCatchUp = Number.isFinite(catchUp) && catchUp > 0 ? catchUp : 1;
  const shed: string[] = [];
  const next = lanes.map((lane) => {
    if (lane.level <= 0) return lane;

    const attempted = lane.bookedLoad + lane.blockedVolume;
    const capacity = laneCapacity(lane.level) * safeCatchUp;
    const marginalLevel = LANES.BASE_LANE_CAPACITY * safeCatchUp;
    const unused = capacity - attempted;

    // Hysteresis, mirroring computeSystemDecay's idle-contraction block literally: the countdown
    // accrues elapsed reference-cycles while ≥1 whole level is idle, and resets the moment it refills.
    let idleCycles = unused >= marginalLevel ? lane.idleCycles + safeCatchUp : 0;
    let level = lane.level;
    if (idleCycles >= params.idleBufferCycles) {
      level = Math.max(0, level - 1); // shed the marginal idle level and restart its countdown
      idleCycles = 0;
      shed.push(lane.key);
    }

    if (level === lane.level && idleCycles === lane.idleCycles) return lane;
    return { ...lane, level, idleCycles };
  });
  return { lanes: next, shed };
}
