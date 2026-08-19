/**
 * Worker-side host abstraction (spec §1, §6) — wraps the raw `postMessage`/`onmessage` boundary so
 * `game-worker.ts` is testable under vitest/node with a fake host, no real `Worker` involved.
 *
 * The message types are generic (`TInbound`/`TOutbound`): this module owns no domain knowledge of
 * the game's protocol (that lives in `game-worker.ts`), only the typed seam between "the raw global"
 * and "our protocol". Structured clone — not JSON — carries a `postMessage` payload across a real
 * worker boundary, and it preserves an object's shape faithfully rather than re-parsing untyped
 * text, so this is not a JSON.parse-style untrusted boundary needing a runtime guard: both ends are
 * this codebase's own typed protocol. No `unknown`, no `as` — `RawWorkerScope`'s `onmessage` is
 * typed directly over `TInbound` rather than DOM's `MessageEvent<any>`, so a real worker's `self`
 * satisfies it by ordinary structural assignability (its `any`-typed members accept the narrower
 * generic), with no cast at the call site.
 */

/** The two members a dedicated worker's global scope provides — `self.postMessage` and
 *  `self.onmessage` — typed over this channel's own message types. A real worker's `self` and a
 *  fake test host (`createFakeWorkerScope` below) both satisfy this shape. */
export interface RawWorkerScope<TInbound, TOutbound> {
  postMessage(message: TOutbound): void;
  onmessage: ((event: { data: TInbound }) => void) | null;
}

/** The narrower surface `game-worker.ts` is written against: post one outbound message, install
 *  the one handler for inbound messages. */
export interface WorkerHost<TInbound, TOutbound> {
  post(message: TOutbound): void;
  onMessage(handler: (message: TInbound) => void): void;
}

/** Wraps a `RawWorkerScope` into a `WorkerHost`. */
export function createWorkerHost<TInbound, TOutbound>(
  scope: RawWorkerScope<TInbound, TOutbound>,
): WorkerHost<TInbound, TOutbound> {
  return {
    post: (message) => scope.postMessage(message),
    onMessage: (handler) => {
      scope.onmessage = (event) => handler(event.data);
    },
  };
}

/** An in-memory `RawWorkerScope` for tests — no real `Worker`, no DOM. `sent` accumulates every
 *  posted message in the order the worker posted it, so a test can assert on exactly what was
 *  emitted; `receive` simulates an inbound message arriving, invoking whatever handler `onMessage`
 *  last installed (mirrors a real `self.onmessage` firing). */
export function createFakeWorkerScope<TInbound, TOutbound>(): RawWorkerScope<TInbound, TOutbound> & {
  sent: TOutbound[];
  receive(message: TInbound): void;
} {
  const sent: TOutbound[] = [];
  const scope: RawWorkerScope<TInbound, TOutbound> & { sent: TOutbound[]; receive(message: TInbound): void } = {
    sent,
    postMessage: (message) => sent.push(message),
    onmessage: null,
    receive: (message) => {
      scope.onmessage?.({ data: message });
    },
  };
  return scope;
}
