import { STRIKE_PARAMS } from "@/lib/constants/population";

/** Stability band labels — derived from unrest (inverted: low unrest = stable). */
export type StabilityLabel = "Stable" | "Calm" | "Tense" | "Unrest" | "Strike";

/** Cold→hot band stops ordered from lowest to highest unrest. */
export const STABILITY_RAMP_STOPS: Record<StabilityLabel, string> = {
  Stable: "#22c55e", // cool green  — low unrest
  Calm: "#14b8a6",   // teal        — rising
  Tense: "#f59e0b",  // amber       — mid unrest
  Unrest: "#f97316", // orange      — high unrest
  Strike: "#ef4444", // red         — critical
};

/**
 * Maps unrest (0…1) to a stability band label. The top edge is bound to
 * `STRIKE_PARAMS.threshold` — the label may never contradict the mechanic it names, so "Strike"
 * starts exactly where striking does: strictly above the threshold, matching `strikeMultiplier`.
 * The other edges are descriptive literals: they gate no mechanic, so their placement is a
 * calibration choice, not a contract.
 */
export function stabilityLabel(unrest: number): StabilityLabel {
  if (unrest < 0.2) return "Stable";
  if (unrest < 0.4) return "Calm";
  if (unrest < 0.5) return "Tense";
  if (unrest <= STRIKE_PARAMS.threshold) return "Unrest";
  return "Strike";
}

/** CSS hex colour for an unrest value (badge accent). */
export function stabilityRampColor(unrest: number): string {
  return STABILITY_RAMP_STOPS[stabilityLabel(unrest)];
}
