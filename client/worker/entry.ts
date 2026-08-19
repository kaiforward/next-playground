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
 */
import { createGameWorker } from "./game-worker";
import type { InboundMessage, OutboundMessage } from "./game-worker";
import type { RawWorkerScope } from "./host";

declare const self: RawWorkerScope<InboundMessage, OutboundMessage>;

createGameWorker(self);
