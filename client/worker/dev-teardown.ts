/**
 * Dev-only teardown/restore mechanism (spec §10, build plan Task 13): a worker module edit under
 * `vite dev` tears down and recreates the running worker (or triggers a full page reload — Vite's
 * documented Worker-HMR limitation) — without mitigation this destroys whatever galaxy was running,
 * unlike the Next dev server's `globalThis`-survives-HMR promise (AGENTS.md: "HMR survives"). The
 * contract: right before the current worker instance goes away, save the running world under a
 * reserved name; the NEXT instance's boot checks for that save, restores it, then deletes it — a
 * genuinely fresh session (no teardown save was ever written, or one was already consumed) is never
 * hijacked.
 *
 * Split from `client/worker/entry.ts` on purpose: the mechanism here takes its dependencies as
 * plain parameters (a `SaveBackend`, the world, a load callback) so it is unit-testable with a fake
 * backend and no real `self`/IndexedDB/`import.meta.hot` — `entry.ts` supplies the real ones and,
 * like `save-indexeddb.ts`'s registration call there, is untestable outside a real worker
 * (documented on that file; not re-argued here). Only the MECHANISM is proven at this level — the
 * real HMR dispose→reboot cycle itself is a Gate D manual smoke (see `entry.ts`'s own docstring).
 */
import type { SaveBackend } from "@/lib/world/save-backend";
import type { World } from "@/lib/world/types";

/** Reserved save name — distinct from `AUTOSAVE_NAME` (`lib/world/save.ts`, a real gameplay
 *  autosave this mechanism never reads or writes) and never surfaced as a player-facing save; the
 *  restore step below removes it immediately after a successful load, so the exposure window in
 *  `listSaves` results is as small as this module can make it. */
export const DEV_TEARDOWN_SAVE_NAME = "__dev-teardown__";

/**
 * The dispose-time write path. A no-op when no world is running (nothing to preserve) — matches
 * every other world-mutating dev path's own "no world loaded" guard rather than writing an empty
 * save that would then wrongly restore into a world-less state on the next boot.
 */
export async function saveTeardownSnapshot(
  backend: SaveBackend,
  world: World | null,
  serialise: (world: World) => string,
): Promise<void> {
  if (!world) return;
  await backend.write(DEV_TEARDOWN_SAVE_NAME, serialise(world));
}

/**
 * The boot-prefers-teardown-save logic. If the reserved save exists, restores from it (via the
 * caller-supplied `loadFromTeardown` — the real worker's own `loadGame` command, dispatched by
 * `entry.ts` against its own `self`) and then removes it, consumed exactly once. A missing save is
 * the ordinary case (first-ever boot, or a prior restore already consumed it) and does nothing —
 * this is what keeps a genuinely fresh `newGame` from ever being hijacked by a stale entry.
 */
export async function restoreTeardownSaveIfPresent(
  backend: SaveBackend,
  loadFromTeardown: (name: string) => Promise<void>,
): Promise<void> {
  const saves = await backend.list();
  if (!saves.some((save) => save.name === DEV_TEARDOWN_SAVE_NAME)) return;
  await loadFromTeardown(DEV_TEARDOWN_SAVE_NAME);
  await backend.remove(DEV_TEARDOWN_SAVE_NAME);
}
