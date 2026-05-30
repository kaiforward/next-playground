import { getProsperityLabel, getProsperityMultiplier, type ProsperityLabel } from "@/lib/engine/tick";
import { PROSPERITY_PARAMS } from "@/lib/constants/economy";

/** Cold→warm diverging stops, one per prosperity label. Reserves green/red for price. */
export const PROSPERITY_RAMP_STOPS: Record<ProsperityLabel, string> = {
  Crisis: "#4f6d9e",    // cold slate-blue
  Disrupted: "#5fa1b3", // muted cyan
  Stagnant: "#8a8f99",  // neutral grey
  Active: "#cf9a4e",    // warm light amber
  Booming: "#e07b2e",   // deep amber / copper
};

/** CSS hex for a prosperity value (badge accent + legend). */
export function prosperityRampColor(prosperity: number): string {
  return PROSPERITY_RAMP_STOPS[getProsperityLabel(prosperity)];
}

/** Numeric colour for Pixi tinting (choropleth fill). */
export function prosperityRampColorPixi(prosperity: number): number {
  return parseInt(prosperityRampColor(prosperity).slice(1), 16);
}

/** Muted descriptor of the mechanical effect, e.g. "Production & Consumption ×1.3". */
export function prosperityEffectLabel(prosperity: number): string {
  const mult = getProsperityMultiplier(prosperity, PROSPERITY_PARAMS);
  return `Production & Consumption ×${mult.toFixed(1)}`;
}
