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
 */
import { createGameWorker } from "./game-worker";
import type { InboundMessage, OutboundMessage } from "./game-worker";
import type { RawWorkerScope } from "./host";
import { setSaveBackend } from "@/lib/world/save-backend";
import { indexedDbSaveBackend, requestPersistentStorage } from "@/client/save-indexeddb";

declare const self: RawWorkerScope<InboundMessage, OutboundMessage>;

setSaveBackend(indexedDbSaveBackend);
requestPersistentStorage();
createGameWorker(self);
