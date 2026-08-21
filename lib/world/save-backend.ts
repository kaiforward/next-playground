/**
 * The save-backend seam (client-runtime spec §5, build plan Task 12) — the interface every save
 * host implements, plus the registration/resolution point that lets `lib/services/game.ts` and
 * `lib/world/tick-loop.ts` call a backend without EITHER of them statically importing an
 * implementation. Two implementations exist: `lib/world/save-files.ts` (Node/file, desktop-shape)
 * and `client/save-indexeddb.ts` (browser/IndexedDB, the web packaging).
 *
 * **Resolution design (the seam-resolution decision this task makes):** `setSaveBackend` is an
 * explicit registration call — the real browser Worker's entry point (`client/worker/entry.ts`,
 * real-Worker-only, never imported by a test) calls it with the IndexedDB backend before the worker
 * starts answering messages. `getSaveBackend` resolves whatever was registered; if nothing ever
 * was — every Node host (the still-alive Next dev server's API routes, `npm run simulate`, unit
 * tests) — it falls back to a dynamic `import("./save-files")`, the same idiom
 * `tick-loop.ts`'s autosave already used for the same reason (AGENTS.md: `lib/` stays free of a
 * static `fs` import; `save-files.ts` is reached only dynamically). This keeps every existing Node
 * caller working with zero wiring changes, while the browser worker's explicit registration means
 * its `getSaveBackend()` calls never take that fallback branch at runtime — see `vite.config.ts`'s
 * own docstring for what this does and does not buy the bundler.
 *
 * Cached on `globalThis` (the same idiom `lib/world/store.ts`/`tick-loop.ts` use) so a dev-server
 * HMR reload doesn't lose a Node-resolved backend, and so a real worker's registration survives
 * whatever import churn happens after boot.
 */

export interface SaveInfo {
  name: string;
  tick: number;
  /** ISO-8601 timestamp — a string so the shape survives the worker/JSON boundary unchanged. */
  savedAt: string;
  bytes: number;
}

/**
 * A save host's contract. `write`/`read` move raw save JSON (the caller serialises/deserialises via
 * `lib/world/save.ts`) — the backend itself is a dumb byte store, never a `World` parser. `write` is
 * atomic-or-recoverable: a reader must never observe a half-written save, and an interrupted write
 * must recover to the LAST GOOD save rather than a torn one. `list` returns `SaveInfo` sourced from
 * an index record written alongside each save — never by parsing every save blob, so listing costs
 * nothing proportional to save size (saves run 5.8–13 MB, client-runtime spec §5).
 */
export interface SaveBackend {
  write(name: string, json: string): Promise<void>;
  read(name: string): Promise<string>;
  list(): Promise<SaveInfo[]>;
  remove(name: string): Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __saveBackend: SaveBackend | undefined;
}

const globalStore: { __saveBackend?: SaveBackend } = globalThis;

/**
 * Registers the active backend explicitly. Called exactly once, by the real browser worker's entry
 * point, before any command that could call `getSaveBackend()` can possibly run (registration is
 * synchronous; the worker only starts processing messages once its module finishes evaluating).
 * Also the test seam every save-backend test uses to install a fake without touching the Node
 * fallback path.
 */
export function setSaveBackend(backend: SaveBackend): void {
  globalStore.__saveBackend = backend;
}

/**
 * Resolves the active backend — whatever `setSaveBackend` registered, or (nothing ever did) the
 * Node/file backend, dynamic-imported the first time it's needed and cached from then on. See this
 * module's header docstring for why the fallback lives here rather than being inlined at every call
 * site.
 */
export async function getSaveBackend(): Promise<SaveBackend> {
  if (globalStore.__saveBackend) return globalStore.__saveBackend;
  const { nodeSaveBackend } = await import("./save-files");
  globalStore.__saveBackend = nodeSaveBackend;
  return globalStore.__saveBackend;
}

/** Test-only: clears whatever was registered/resolved so each test starts from a clean seam. */
export function resetSaveBackendForTesting(): void {
  globalStore.__saveBackend = undefined;
}
