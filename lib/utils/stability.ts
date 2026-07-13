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

/** Maps unrest (0…1) to a stability band label. */
export function stabilityLabel(unrest: number): StabilityLabel {
  if (unrest < 0.2) return "Stable";
  if (unrest < 0.4) return "Calm";
  if (unrest < 0.6) return "Tense";
  if (unrest < 0.8) return "Unrest";
  return "Strike";
}

/** CSS hex colour for an unrest value (badge accent). */
export function stabilityRampColor(unrest: number): string {
  return STABILITY_RAMP_STOPS[stabilityLabel(unrest)];
}
