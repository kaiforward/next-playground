/**
 * Dev-only reload-restore marker (build plan Task 13 correction — Gate D smoke finding, real
 * browser: editing a worker-graph file mid-game landed on the START SCREEN instead of back in the
 * running galaxy). Diagnosis: Vite does not support HMR for web workers
 * (https://vite.dev/guide/api-hmr) — an edit anywhere in the worker's module graph instead fires
 * `vite:beforeFullReload` on the PAGE client and reloads the whole document, which terminates the
 * worker abruptly rather than disposing it through Vite's HMR runtime. The worker-side
 * `import.meta.hot.dispose` this task originally wired (`client/worker/entry.ts`, `dev-teardown.ts`)
 * never fired and has been removed rather than left as a plausible-looking dead mechanism.
 *
 * The real fix is page-side. `vite:beforeFullReload` fires on the page BEFORE `location.reload()`
 * runs, giving a synchronous window to set a `sessionStorage` marker — it survives the reload (same
 * tab) but dies with the tab, so it can never leak into an unrelated later session. The actual world
 * SAVE is deliberately NOT attempted from inside that handler: an async `saveGame` command posted
 * there would race `location.reload()` with no guarantee of completing first. Instead this reuses
 * the `pagehide` autosave that already fires reliably for a full reload (`client/main.tsx`'s
 * `handlePageHideSave`, spec §5/§11 — a full reload is a real navigation, so `pagehide` fires for it
 * exactly as it does for a manual refresh or tab close) — on the next boot, the marker being present
 * means "load `AUTOSAVE_NAME` instead of leaving the fresh worker world-less."
 *
 * Same "prefer-on-boot, consume-once" SHAPE the removed `dev-teardown.ts` established (and the same
 * reason: a normal F5 refresh must still land on the start screen, since it never fires
 * `vite:beforeFullReload`) — adapted here for `sessionStorage` rather than a `SaveBackend`, since a
 * marker has no listing/removal semantics worth borrowing from that interface.
 */

export const DEV_RELOAD_MARKER_KEY = "stellar-trader:dev-reload-restore";

/** Set synchronously from the `vite:beforeFullReload` handler, before the reload actually happens. */
export function markPendingDevReload(storage: Pick<Storage, "setItem">): void {
  storage.setItem(DEV_RELOAD_MARKER_KEY, "1");
}

/** Checked once at boot. Consumes (removes) the marker if present, so only the ONE boot immediately
 *  following a dev-triggered reload restores — a later, genuinely fresh boot never finds it again. */
export function consumePendingDevReload(storage: Pick<Storage, "getItem" | "removeItem">): boolean {
  const present = storage.getItem(DEV_RELOAD_MARKER_KEY) !== null;
  if (present) storage.removeItem(DEV_RELOAD_MARKER_KEY);
  return present;
}
