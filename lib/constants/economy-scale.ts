/**
 * Global economy-scale knob. A single multiplier S applied to the goods-side
 * magnitudes of the economy (production, consumption, seeded stock) and the
 * absolute terms that ride them. Ratio/dimensionless terms (target-cover, price
 * exponent, thresholds, route cost) deliberately do NOT scale, so prices and
 * equilibrium are invariant under S — only magnitudes change. See
 * docs/planned/economy-scale-knob.md.
 *
 * This module imports NOTHING: it is the root of the constants-magnitude graph,
 * so any import would risk a circular dependency. Server-only — it is never read
 * for its value by the client (the client consumes already-scaled data from the
 * API), so it is intentionally not exposed via next.config.ts `env`.
 */

/** Parse + validate the scale: a positive, finite number. Throws on anything else. */
export function toEconomyScale(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ECONOMY_SCALE: "${value}". Expected a positive, finite number.`);
  }
  return n;
}

/**
 * Active economy scale, resolved once from the environment. Defaults to 100 — the scale the game is
 * balanced and played at — so the calibration harness matches the live game without needing `.env` set
 * (the dev server auto-loads `.env`; the headless sim doesn't). Tests pin this to 1 via the vitest
 * config (their magnitude assertions are written at unit scale).
 */
export const ECONOMY_SCALE: number = toEconomyScale(process.env.ECONOMY_SCALE ?? "100");

/** Scale a single magnitude by the active economy scale. */
export function scaleValue(n: number): number {
  return n * ECONOMY_SCALE;
}

/** Scale every numeric value of a record by the active economy scale (keys unchanged). */
export function scaleRecord(record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = value * ECONOMY_SCALE;
  }
  return out;
}
