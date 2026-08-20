/**
 * The dedicated Worker module Vite actually instantiates (`new Worker(new URL("./worker/entry.ts",
 * import.meta.url), { type: "module" })`, `client/main.tsx`). Wires the real worker global scope to
 * `createGameWorker` via `host.ts`'s `RawWorkerScope` seam.
 *
 * `game-worker.ts` deliberately does not bind itself to a real `self` — its header docstring: "that
 * binding... is the Vite worker entry's job, not this module's" — so this file exists to do exactly
 * that, and nothing else (kept import-only, matching the same "small, inspectable static surface"
 * discipline `game-worker.ts` and `boot.ts` follow, spec §6).
 *
 * `self` is declared locally rather than pulling in TypeScript's "webworker" lib globally: this
 * project's `tsconfig.json` carries `"dom"` for the rest of the app, and `"dom"` / `"webworker"`
 * declare conflicting global `self` types when both are in scope in the same program (the classic
 * "Subsequent variable declarations must have the same type" clash). A module-scoped `declare const
 * self` shadows the ambient dom-typed `self` for THIS FILE's type-checking only — it erases to
 * nothing at runtime, so the real dedicated-worker-scope `self` the browser provides is what actually
 * runs; the declared shape is exactly `RawWorkerScope`'s (`postMessage`/`onmessage`), which a real
 * worker's `self` satisfies structurally.
 *
 * **Save-backend registration (build plan Task 12):** this is the one place that registers the
 * browser `SaveBackend` (`client/save-indexeddb.ts`) via `setSaveBackend`
 * (`lib/world/save-backend.ts`) — deliberately here rather than `boot.ts`, because `boot.ts` runs
 * from BOTH the real worker AND `boot.test.ts` (which dynamically imports it directly, no real
 * `self`, no IndexedDB polyfill); registering here instead means every worker/save test that
 * exercises `createGameWorker` against a fake host (`game-worker.test.ts`, still on the Node/file
 * backend via `setSavesDirForTesting`) is completely unaffected — this file, by contrast, cannot be
 * imported outside a real worker at all (`self` is undefined under Node), so it carries no test
 * obligation the fake-host suite could satisfy anyway; the browser-side seam is proven at
 * `client/save-indexeddb.ts`'s own unit level and exercised for real only at a Gate D browser smoke.
 * Registration is synchronous and happens before `createGameWorker` installs its message handler, so
 * no command can possibly reach `getSaveBackend()` before this has run.
 *
 * **Dev teardown/restore (build plan Task 13, spec §10):** gated on `import.meta.hot` — Vite's HMR
 * context handle, present only under `vite dev` and statically `undefined` in a production build
 * (the same dead-code-elimination idiom `dev-commands.ts` uses for `import.meta.env.DEV`, applied
 * to the HMR-specific signal since this feature is inherently tied to HMR rather than to dev-ness in
 * general). `hot.dispose` fires right before THIS module instance is torn down for a replacement —
 * the mechanism itself (write-on-dispose, prefer-on-boot) lives in `dev-teardown.ts`, unit-tested
 * there against a fake `SaveBackend`; what's here is the real-`self`-only wiring: polling a cheap
 * `listSaves` command (mirrors `game-worker.test.ts`'s own `waitForBoot` helper, driven from outside
 * a worker) until boot completes, then dispatching a real `loadGame` command against the reserved
 * save name through this worker's own `self.onmessage` — the same "post a message this worker's own
 * handler will see" technique the fake-host tests use, aimed at the real `self` instead of a fake
 * one. Untestable under Node (no `self`, no `import.meta.hot`), so the real HMR cycle is a Gate D
 * manual smoke, not a unit proof — see `dev-teardown.ts`'s own docstring.
 */
import { createGameWorker } from "./game-worker";
import type { InboundMessage, OutboundMessage } from "./game-worker";
import type { RawWorkerScope } from "./host";
import { setSaveBackend } from "@/lib/world/save-backend";
import { indexedDbSaveBackend, requestPersistentStorage } from "@/client/save-indexeddb";
import { hasWorld, getWorld } from "@/lib/world/store";
import { serialiseWorld } from "@/lib/world/save";
import { saveTeardownSnapshot, restoreTeardownSaveIfPresent } from "./dev-teardown";

declare const self: RawWorkerScope<InboundMessage, OutboundMessage>;

setSaveBackend(indexedDbSaveBackend);
requestPersistentStorage();
createGameWorker(self);

if (import.meta.hot) {
  const hot = import.meta.hot;

  hot.dispose(() => {
    // Fire-and-forget: HMR disposes this module synchronously right after `dispose` returns, so the
    // write cannot be awaited — same posture as the pagehide save (`client/worker-connection.ts`'s
    // `handlePageHideSave`).
    void saveTeardownSnapshot(indexedDbSaveBackend, hasWorld() ? getWorld() : null, serialiseWorld);
  });

  void restoreTeardownSaveIfPresent(indexedDbSaveBackend, loadFromTeardownViaSelf);
}

/** Polls with a `listSaves` probe (a fresh id each attempt) until a `commandResult` answers it
 *  `ok: true` — the same "no boot signal but a probe reply" technique
 *  `game-worker.test.ts`'s `waitForBoot` uses, necessary here because entry.ts has no other way to
 *  observe `createGameWorker`'s internal `bootPromise` settling. Once booted, dispatches the real
 *  `loadGame` command and resolves once ITS result lands. */
function loadFromTeardownViaSelf(name: string): Promise<void> {
  const PROBE_PREFIX = "dev-teardown-boot-probe-";
  return new Promise((resolve) => {
    const original = self.postMessage.bind(self);
    let booted = false;
    const loadId = crypto.randomUUID();
    let interval: ReturnType<typeof setInterval> | null = null;

    self.postMessage = (message: OutboundMessage) => {
      original(message);
      if (message.type !== "commandResult") return;
      if (!booted && message.id.startsWith(PROBE_PREFIX) && message.result.ok) {
        booted = true;
        if (interval) clearInterval(interval);
        self.onmessage?.({ data: { type: "command", envelope: { id: loadId, type: "loadGame", payload: { name } } } });
        return;
      }
      if (message.id === loadId) {
        self.postMessage = original;
        resolve();
      }
    };

    const probe = () => {
      self.onmessage?.({
        data: { type: "command", envelope: { id: `${PROBE_PREFIX}${Date.now()}`, type: "listSaves", payload: null } },
      });
    };
    probe();
    interval = setInterval(probe, 25);
  });
}
