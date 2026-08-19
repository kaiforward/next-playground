/**
 * Worker entry seam (spec §6): sets the host config global from a `BootConfig` (the worker's boot
 * message, `lib/runtime/channel.ts`) BEFORE dynamically importing anything that reaches
 * `lib/constants/economy-scale.ts` — its `ECONOMY_SCALE` and the two debug flags are consumed AT
 * MODULE EVALUATION by ~10 downstream constant tables, so nothing that imports them may run before
 * this resolves (`resolveHostConfig`'s worker branch reads exactly this global).
 *
 * Kept dependency-light on purpose: this module exists only to run before the heavy graph, so it
 * must not itself pull that graph in via a static import — only `BootConfig`'s type crosses the
 * boundary (erased at compile time; no runtime import).
 */
import type { BootConfig } from "@/lib/runtime/channel";

/**
 * Sets the boot configuration global, then dynamically imports the constants root so its
 * module-evaluation-time `scaleValue`/`scaleRecord` tables see the resolved scale. `economyScale`
 * is re-stringified so the single validating parser (`toEconomyScale`) runs identically regardless
 * of host. Returns the imported module so a caller — or a test proving "a worker booted with scale
 * S yields S-scaled constant tables" — can assert against it without a second, separately-timed
 * import racing this one.
 */
export async function bootHost(config: BootConfig) {
  globalThis.__hostConfig = {
    economyScale: String(config.economyScale),
    debugEconomy: config.debugEconomy,
    debugEvents: config.debugEvents,
  };
  return import("@/lib/constants/economy-scale");
}
