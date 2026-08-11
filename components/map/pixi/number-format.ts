import type { ValueMode } from "./value-ramp";

/**
 * Compact label for an aggregated choropleth value. Population reads as a count with SI-ish K/M
 * suffixes (1-decimal in the low-millions, whole above 10M); development is a raw tier-weighted
 * development-points score, rendered as a rounded absolute number; stability is a 0..1 score, rendered
 * as a 0–100 integer (×100); migration and provision are colour-only (no on-map numbers — see
 * `SHOWS_NUMBERS` in value-choropleth-layer.ts) but both still format, migration as a raw rounded
 * value and provision as a 0..1 fraction ×100 like stability, so the function stays honest if either
 * is ever surfaced (e.g. a future hover readout).
 */
export function formatValueNumber(value: number, mode: ValueMode): string {
  if (mode === "population") {
    if (value >= 1e6) return `${(value / 1e6).toFixed(value < 1e7 ? 1 : 0)}M`;
    if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
    return `${Math.round(value)}`;
  }
  if (mode === "development") return `${Math.round(value)}`;
  if (mode === "migration") return `${Math.round(value)}`;
  // stability and provision both fall through here — both are 0..1 fractions rendered ×100.
  return `${Math.round(value * 100)}`;
}
