/**
 * Global economy-scale knob. A single multiplier S applied to the goods-side
 * magnitudes of the economy (production, consumption, seeded stock) and the
 * absolute terms that ride them. Ratio/dimensionless terms (target-cover, price
 * exponent, thresholds, route cost) deliberately do NOT scale, so prices and
 * equilibrium are invariant under S — only magnitudes change.
 *
 * This module imports NOTHING: it is the root of the constants-magnitude graph,
 * so any import would risk a circular dependency. Worker-only — it is never read
 * for its value by the UI thread (the UI thread consumes already-scaled data
 * riding the snapshot store), so it is intentionally not exposed to it.
 *
 * `ECONOMY_SCALE` and the debug flags below are consumed AT MODULE EVALUATION
 * (by this module and, at import, by ~10 downstream constant tables) — so no
 * runtime message can change them after import. `resolveHostConfig` is the
 * dual-host seam: under Node it reads `process.env` (unchanged from before);
 * under the worker it reads a host-set global that `client/worker/boot.ts`
 * assigns BEFORE dynamically importing this module (or anything that imports
 * it), so the module-evaluation-time read below sees the resolved value.
 */

/** Raw, unvalidated boot configuration — the shape `resolveHostConfig` returns. */
export interface HostConfig {
  /** Raw `ECONOMY_SCALE` string; undefined means "use the default" (validated by `toEconomyScale`). */
  economyScale?: string;
  debugEconomy: boolean;
  debugEvents: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __hostConfig: HostConfig | undefined;
}

/**
 * Resolves boot configuration for this module and the two debug-flag readers
 * (`lib/tick/processors/economy.ts`, `events.ts`). Reads the worker's host-set
 * global when present (`client/worker/boot.ts` sets it before the dynamic import
 * that reaches here); otherwise reads `process.env` (Node: the dev server, the
 * `npm run simulate` harness, tests) — today's behaviour, unchanged.
 */
export function resolveHostConfig(): HostConfig {
  if (globalThis.__hostConfig !== undefined) return globalThis.__hostConfig;
  // Vite's browser bundle has no `process` global at all — reached only if a caller imports this
  // module without going through `client/worker/boot.ts` (which sets `__hostConfig` before the
  // dynamic import that reaches here). The guard keeps that misuse a defined "no override
  // requested" default instead of a `ReferenceError: process is not defined` crash.
  if (typeof process === "undefined") {
    return { debugEconomy: false, debugEvents: false };
  }
  return {
    economyScale: process.env.ECONOMY_SCALE,
    debugEconomy: process.env.DEBUG_ECONOMY === "1",
    debugEvents: process.env.DEBUG_EVENTS === "1",
  };
}

/**
 * Throws when a host config's requested scale disagrees with the already-resolved
 * `ECONOMY_SCALE` constant — the fault this detects is an import that reached this
 * module's module-evaluation-time `toEconomyScale` call before the host configuration
 * was fully resolved (Node: an import placed above `dotenv/config` in
 * `scripts/simulate.ts`; worker: an import that reached the constants graph before
 * `client/worker/boot.ts` set the host global), which silently freezes the constant at
 * whatever was resolvable at that earlier point instead of the requested value.
 * A no-op when `hostConfig.economyScale` is undefined (no override requested).
 */
export function assertHostConfigResolved(hostConfig: HostConfig, resolved: number): void {
  if (hostConfig.economyScale === undefined) return;
  const requested = toEconomyScale(hostConfig.economyScale);
  if (requested !== resolved) {
    throw new Error(
      `ECONOMY_SCALE mismatch: boot configuration asks for ${requested}, but the constants resolved to ` +
        `${resolved}. Something imported lib/constants/economy-scale.ts before boot configuration was ` +
        `fully resolved — under Node, move the reaching import below the dotenv import in ` +
        `scripts/simulate.ts; under the worker, client/worker/boot.ts must set the host config global ` +
        `before its dynamic import of the engine/constants graph.`,
    );
  }
}

/** Parse + validate the scale: a positive, finite number. Throws on anything else. */
export function toEconomyScale(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ECONOMY_SCALE: "${value}". Expected a positive, finite number.`);
  }
  return n;
}

/**
 * Active economy scale, resolved once from boot configuration. Defaults to 100 — the scale the game is
 * balanced and played at — so the calibration harness matches the live game without needing `.env` set
 * (the dev server auto-loads `.env`; the headless harness doesn't). Tests pin this to 1 via the vitest
 * config (their magnitude assertions are written at unit scale).
 */
export const ECONOMY_SCALE: number = toEconomyScale(resolveHostConfig().economyScale ?? "100");

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
