/**
 * Dev-only command registry (build plan Task 13; spec §10: "Dev inspection of the world... is a
 * dev-only command exposing the current snapshot"). Reached ONLY via a dynamic `import()` inside
 * `game-worker.ts`'s `loadEngine`, itself guarded by the literal `import.meta.env.DEV` — never
 * `isDevBuild()` (`lib/utils/dev-flag.ts`): Vite/Rollup's dead-code elimination needs the guard
 * expression to be `import.meta.env.DEV` verbatim, textually replaced with `true`/`false` at build
 * time BEFORE Rollup's tree-shaking pass runs. Routing the guard through a shared helper function
 * does not give Rollup the same static guarantee — the helper's own `??` fallback means the whole
 * expression is no longer a literal constant Rollup can fold before tracing imports. `game-worker.ts`
 * is never reached by webpack at all (only type-imported from `lib/`), so this file has no
 * webpack-vs-Vite tension the way `lib/utils/dev-flag.ts` does.
 *
 * A production Vite build therefore never traces this module's dynamic import target at all —
 * `lib/services/dev-tools.ts` and everything it pulls in ships in dev bundles only. Proven by the
 * Task 13 bundle grep (see the build plan's PR notes for the exact command/output).
 *
 * The dev command types are intentionally NOT part of `GameCommandMap` (`game-worker.ts`) — that
 * union backs the production command protocol. `game-worker.ts`'s `runCommand` widens to accept
 * `DevCommandEnvelope` alongside it and answers dev cases only when `Engine.dev` was actually
 * populated (a dev build) — kept as a logically separate union even though TypeScript types
 * themselves are erased and carry no bundle cost either way (recorded per this task's judgment-call
 * line: "their types must not leak into the production command union in a way that breaks the
 * build-time exclusion").
 */
import type { CommandEnvelope, CommandResult } from "@/lib/runtime/channel";
import type { EconomySnapshotSystem, WorldInspection } from "@/lib/services/dev-tools";

export interface DevCommandMap {
  advanceTicks: { payload: { count: number }; data: { newTick: number; elapsed: number } };
  spawnEvent: {
    payload: { systemId: string; eventType: string; severity?: number };
    data: { eventId: string; type: string; phase: string };
  };
  resetEconomy: { payload: null; data: { marketsReset: number; eventsCleared: number } };
  economySnapshot: { payload: null; data: { systems: EconomySnapshotSystem[] } };
  inspectWorld: { payload: null; data: WorldInspection };
}

export type DevCommandType = keyof DevCommandMap;

/** One posted dev command — same envelope shape `GameCommandEnvelope` uses, over the dev map. */
export type DevCommandEnvelope = {
  [K in DevCommandType]: CommandEnvelope<K, DevCommandMap[K]["payload"]>;
}[DevCommandType];

/** One dev command's answer, correlated back to its envelope's `id`. */
export type DevCommandResultMessage = {
  [K in DevCommandType]: { type: "commandResult"; id: string; result: CommandResult<DevCommandMap[K]["data"]> };
}[DevCommandType];

/**
 * Bound handlers over `lib/services/dev-tools.ts`, loaded once by `loadEngine` and cached on
 * `Engine.dev`. Mirrors that module's own function signatures — only `advanceTicks` is async (it
 * awaits `TickLoop.runTicks`); the rest are synchronous reads/writes, kept that way here so
 * `game-worker.ts`'s `runWorldMutatingCommand` helper (the same tick-boundary queueing every other
 * world-mutating command goes through) can wrap `spawnEvent`/`resetEconomy` directly.
 */
export interface DevHandlers {
  advanceTicks(payload: { count: number }): Promise<CommandResult<DevCommandMap["advanceTicks"]["data"]>>;
  spawnEvent(
    payload: DevCommandMap["spawnEvent"]["payload"],
  ): CommandResult<DevCommandMap["spawnEvent"]["data"]>;
  resetEconomy(): CommandResult<DevCommandMap["resetEconomy"]["data"]>;
  economySnapshot(): CommandResult<DevCommandMap["economySnapshot"]["data"]>;
  inspectWorld(): CommandResult<DevCommandMap["inspectWorld"]["data"]>;
}

/** The dynamic import a production build never traces — see this module's header docstring. */
export async function loadDevHandlers(): Promise<DevHandlers> {
  const devTools = await import("@/lib/services/dev-tools");
  return {
    advanceTicks: (payload) => devTools.advanceTicks(payload.count),
    spawnEvent: (payload) => devTools.spawnEvent(payload),
    resetEconomy: () => devTools.resetEconomy(),
    economySnapshot: () => devTools.getEconomySnapshot(),
    inspectWorld: () => devTools.inspectWorld(),
  };
}
