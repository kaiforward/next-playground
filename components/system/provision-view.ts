/**
 * Population-tab view-model: the system band's label/tone, the Provisioned track's segments, and
 * the occupancy bar's fill/overshoot/crowding read. No DOM, no React — the unit project has no
 * jsdom, so the logic that deserves tests lives here and the components stay thin.
 */
import { SUPPLIED_PROVISION, RATIONING_PROVISION } from "@/lib/constants/economy";
import { POPULATION_PARAMS } from "@/lib/constants/population";
import { crowdFactor, type SupplyRegime } from "@/lib/engine/population";
import type { BadgeColor } from "@/components/ui/badge";

/** Capitalised band label, the Settled vocabulary's four words (docs/build-plans/pr6-presentation.md
 *  "Settled vocabulary"). "Strained" is the shipped code's word and stays — it is NOT the spec's
 *  older "Low reserve", which belongs to the separate per-good stock ladder. */
export const BAND_LABEL: Record<SupplyRegime, string> = {
  supplied: "Supplied",
  strained: "Strained",
  rationing: "Rationing",
  shortage: "Shortage",
};

export function bandLabel(band: SupplyRegime): string {
  return BAND_LABEL[band];
}

/**
 * Badge colour token per band (see `components/ui/badge.tsx`'s `BadgeColor`) — an identifier for the
 * component to apply, never a Tailwind class string or hex value.
 *
 * One tone per band, all four distinct. The chip is word-primary, so colour is a secondary cue —
 * but it cannot be a *collapsing* one: the Provisioned map mode is a stepped choropleth painting
 * each band its own colour, so a chip that rendered Strained and Rationing alike would disagree with
 * the map about how many states exist. Slate for Strained is the deliberate choice over a second
 * amber: Strained means "worth watching", and warning colour belongs to Rationing, where delivery is
 * actually short.
 */
export const BAND_TONE: Record<SupplyRegime, BadgeColor> = {
  supplied: "green",
  strained: "slate",
  rationing: "amber",
  shortage: "red",
};

export function bandTone(band: SupplyRegime): BadgeColor {
  return BAND_TONE[band];
}

/** A band that owns a span of the Provision axis. Shortage is excluded by construction — see
 *  `provisionScaleSegments`. */
export type ProvisionAxisBand = Exclude<SupplyRegime, "shortage">;

export interface ProvisionSegment {
  band: ProvisionAxisBand;
  /** Percentage of the track's full width; the three entries sum to 100. */
  width: number;
}

/**
 * The Provisioned track's segments, in left-to-right (ascending Provision) order — so a rule drawn
 * at a raw percentage position (today's level, the remembered level) lands inside the segment that
 * actually contains it. Widths are derived from `SUPPLIED_PROVISION`/`RATIONING_PROVISION`, never
 * authored: Rationing spans `[0, RATIONING_PROVISION)`, Strained spans `[RATIONING_PROVISION,
 * SUPPLIED_PROVISION)`, Supplied spans `[SUPPLIED_PROVISION, 1]` — moving either constant moves
 * exactly the two segments it borders, the same edges the classifier itself bins on.
 *
 * **There are three, not four.** Shortage is the survival punch-through (`hasSurvivalShortfall`)
 * and can occur at ANY Provision value, so it owns no span of this axis — a world can read Shortage
 * at a high Provisioned. It is excluded from the type rather than returned at zero width: a
 * zero-width entry is a special case wearing a general case's clothes, and rendered as a flex child
 * with a divider it produces a one-pixel artifact at the track's edge. The band chip carries
 * Shortage; the track carries the axis.
 */
export function provisionScaleSegments(): ProvisionSegment[] {
  return [
    { band: "rationing", width: RATIONING_PROVISION * 100 },
    { band: "strained", width: (SUPPLIED_PROVISION - RATIONING_PROVISION) * 100 },
    { band: "supplied", width: (1 - SUPPLIED_PROVISION) * 100 },
  ];
}

export type CrowdChip = "comfortable" | "crowding" | "braked";

export interface OccupancyBar {
  /** Percentage OF CAPACITY (population/popCap × 100) filled up to capacity. Never exceeds 100. */
  fillPct: number;
  /**
   * Percentage OF CAPACITY represented by the overshoot past capacity — the SAME "percent of
   * capacity" scale `fillPct` uses, not a fraction of some separate overshoot allowance. Bounded at
   * `(crowdBrakeEnd − 1) × 100` (15 today, the growth brake's own excess span): a bar that kept
   * growing `overshootPct` past that point would show a system as more crowded than the sim's own
   * growth math ever treats it.
   */
  overshootPct: number;
  crowdChip: CrowdChip;
}

/** The overshoot scale's ceiling — the growth brake's own excess span, never negative even if a
 *  malformed `crowdBrakeEnd <= 1` were ever configured. */
const OVERSHOOT_SPAN_PCT = Math.max(0, (POPULATION_PARAMS.crowdBrakeEnd - 1) * 100);

function crowdChipFromFactor(factor: number): CrowdChip {
  if (factor >= 1) return "comfortable";
  if (factor <= 0) return "braked";
  return "crowding";
}

/**
 * Occupancy read for the Population tab's bar: how full, how far over, and the three-state crowding
 * chip. Occupancy above 100% is the designed-normal state (housing overshoot before the growth
 * brake bites), not an error — `fillPct` never exceeds 100, but `overshootPct` renders it.
 *
 * `crowdChip` is read directly off `crowdFactor` — the exact growth-brake function
 * (`lib/engine/population.ts`), called with the exact `POPULATION_PARAMS.crowdBrakeEnd` the tick
 * uses — rather than an independently authored cut, per the Settled layout's "a crowding chip...
 * comfortable / crowding / braked": comfortable is `crowdFactor === 1` (r ≤ 1, full growth), braked
 * is `crowdFactor === 0` (r ≥ crowdBrakeEnd, or `popCap ≤ 0` — crowdFactor's own "fully crowded"
 * reading), crowding is everywhere the smoothstep ramp sits between. The band-constants test
 * (`lib/constants/__tests__/band-constants.test.ts`, "shares one brake-end...") already pins
 * `POPULATION_PARAMS.crowdBrakeEnd` to `CROWDING.BRAKE_END`, so importing either would agree; this
 * imports the one the growth brake's own live call sites (`lib/engine/population.ts`,
 * `lib/services/system-population.ts`) pass to `crowdFactor`.
 *
 * `popCap ≤ 0` (collapsed housing, e.g. after decay) is a real state the panel must render, not a
 * division by zero: capacity reads 0% full and, if anyone still lives there, pins `overshootPct` at
 * its bounded maximum (the same ceiling the bounded-overshoot branch uses) rather than an undefined
 * ratio.
 */
export function occupancyBar(population: number, popCap: number): OccupancyBar {
  const crowdChip = crowdChipFromFactor(crowdFactor(population, popCap, POPULATION_PARAMS.crowdBrakeEnd));

  if (popCap <= 0) {
    return { fillPct: 0, overshootPct: population > 0 ? OVERSHOOT_SPAN_PCT : 0, crowdChip };
  }

  const r = population / popCap;
  const fillPct = Math.min(r, 1) * 100;
  const span = POPULATION_PARAMS.crowdBrakeEnd - 1;
  const overshootPct = span > 0
    ? Math.min(Math.max(r - 1, 0), span) * 100
    : (r > 1 ? OVERSHOOT_SPAN_PCT : 0);

  return { fillPct, overshootPct, crowdChip };
}
