/**
 * Pure decomposition of the unrest floor's three standing terms, for the panel that answers "why is
 * this world angry" instead of showing one opaque number. Zero DB/world dependency — every input is
 * a resolved number or supply state the caller (the service) already looked up; the faction → tax
 * pressure lookup and the persisted-state resolution live there, never here.
 *
 * `unrestContributors` mirrors exactly the three terms the population processor composes
 * (`lib/tick/processors/population.ts:84-100`): `goods` is `supplyUnrestTerm`, `tax` is the
 * caller-resolved standing tax pressure, `crowding` is `crowdingPressure`. Their sum is
 * `floor + term` — the fixed point `accumulateUnrest` relaxes unrest toward, independent of the
 * relaxation rate (see the `UnrestParams` docstring) — so for the same inputs the tick used, the
 * three contributors reproduce exactly what the panel calls "settled": the three causes cannot fail
 * to sum to the effect, because they ARE the effect's own decomposition, not a re-derived estimate
 * of it.
 */

import { clamp } from "@/lib/utils/math";
import { crowdingPressure, supplyUnrestTerm, type SupplyState, type UnrestParams } from "@/lib/engine/population";
import { CROWDING } from "@/lib/constants/population";

export interface UnrestContributorInput {
  /** The expectation-relative shortfall — `grievanceShortfall`'s output, already resolved. */
  grievance: number;
  /** The absolute dissatisfaction this cycle, `1 − Provision`. */
  d: number;
  /** The system's supply reading — `foldSupplyState`'s output. */
  supply: SupplyState;
  /** The owning faction's standing tax pressure, already resolved — 0 for no faction or no
   *  treasury entry, never a substituted default. */
  taxPressure: number;
  population: number;
  popCap: number;
  /** The crowding ramp's shared boundary with the growth brake (`POPULATION_PARAMS.crowdBrakeEnd`). */
  crowdBrakeEnd: number;
  unrest: UnrestParams;
}

export interface UnrestContributors {
  /** The supply term — `supplyUnrestTerm`, whichever reads larger of the memory-relative grievance
   *  reading and the absolute crisis reading. */
  goods: number;
  /** The standing tax-pressure floor contribution. */
  tax: number;
  /** The standing crowding-pressure floor contribution — 0 at or below the crowding onset, capped
   *  at `CROWDING.PRESSURE_MAX`. */
  crowding: number;
}

export function unrestContributors(input: UnrestContributorInput): UnrestContributors {
  const goods = supplyUnrestTerm(input.grievance, input.d, input.supply, input.unrest);
  const tax = clamp(input.taxPressure, 0, 1);
  const crowding = crowdingPressure(input.population, input.popCap, input.crowdBrakeEnd, CROWDING.PRESSURE_MAX);
  return { goods, tax, crowding };
}

export type UnrestTrend = "rising" | "stable" | "recovering";

/**
 * Whether unrest is heading up, down, or nowhere — the settled value it is relaxing toward compared
 * against where it stands right now. No stored history: the comparison is entirely a function of the
 * two numbers the caller already has (current unrest and the settled target from
 * `unrestContributors`'s sum), so a fresh world with no prior unrest still lands on a defined arm
 * (`unrestTrend(0, 0)` is "stable", not undefined). Exact equality reads "stable" — the boundary
 * belongs to a real third arm, not a gap between "rising" and "recovering".
 */
export function unrestTrend(current: number, settled: number): UnrestTrend {
  if (settled > current) return "rising";
  if (settled < current) return "recovering";
  return "stable";
}
