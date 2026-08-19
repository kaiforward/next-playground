/**
 * The UI-side snapshot store (client-runtime spec §2) — holds the latest committed state frame
 * and pacing frame the worker has posted, notifying subscribers once per applied frame. Zustand's
 * vanilla `createStore` supplies the subscribe/getState plumbing over `useSyncExternalStore`; this
 * module owns the actual merge semantics (structural sharing via `replaceEqualDeep`), the
 * out-of-order/duplicate-version guard, and the liveness field — none of that is Zustand's job.
 *
 * UI-side only: no imports from `lib/world/` beyond the *types* the channel already names
 * (`lib/runtime/channel.ts`, `lib/runtime/snapshot.ts`) — frames arrive over the worker channel,
 * never by reading the world singleton directly.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PacingFrame } from "@/lib/runtime/channel";
import type { SnapshotSlices, StateFrame } from "@/lib/runtime/snapshot";
import { replaceEqualDeep } from "./replace-equal-deep";

/** Worker-liveness, driven by `worker.onerror`/`onmessageerror` plus a heartbeat (spec §4).
 *  `"no-world"` is the pre-boot/pre-new-game state; this task only names the field — nothing here
 *  yet drives it off a real worker. */
export type Liveness = "no-world" | "live" | "paused" | "dead";

/**
 * The store's held shape. `slices` and `worldVersion` come from applied `StateFrame`s;
 * `worldVersion: null` means no state frame has been applied yet (the empty-store case) and is
 * what makes the first-ever frame always pass the freshness check below. `pacing` is a fully
 * separate field fed by `PacingFrame`s, which carry no `worldVersion` and never touch `slices` —
 * pacing (tick/speed/achievedTps/events) and world-state slices are two independent channels that
 * happen to share one store, not one merged record, so an out-of-order pacing frame can never
 * clobber slice state or vice versa.
 */
export interface StoreState {
  slices: Partial<SnapshotSlices>;
  worldVersion: number | null;
  pacing: PacingFrame | null;
  liveness: Liveness;
}

const INITIAL_STATE: StoreState = {
  slices: {},
  worldVersion: null,
  pacing: null,
  liveness: "no-world",
};

export interface GameStore {
  /**
   * Merges `frame.slices` into the held slices via `replaceEqualDeep` and adopts
   * `frame.worldVersion` — but only when `frame.worldVersion` is strictly newer than the held
   * version. A frame at or behind the held version is dropped: "behind" is out-of-order-delivery
   * safety (the throttle can coalesce and reorder is not expected, but a stale frame must never
   * regress state), and "equal" is the notify contract itself — "once per committed world
   * version" (spec §2) means a version already observed must not notify a second time even if
   * the same frame is resent. Either way, a dropped frame does not call `subscribe`d listeners.
   */
  applyStateFrame(frame: StateFrame): void;
  /**
   * Merges `frame` into the held pacing state via `replaceEqualDeep` and always notifies —
   * pacing frames carry no version to de-duplicate against, and every posted pacing frame is by
   * definition a new pacing observation (tick advanced, speed changed, or achievedTps recomputed).
   */
  applyPacingFrame(frame: PacingFrame): void;
  setLiveness(liveness: Liveness): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): StoreState;
  /**
   * The underlying Zustand vanilla store, narrowed to the read-only surface (`getState`,
   * `getInitialState`, `subscribe`) Zustand's own `useStore` accepts — not part of the plan's
   * stated 5-method surface, but `useGameSlice` (`use-game-store.ts`) needs a store api to bind
   * `useStore`'s selector-based re-renders against, and creating a second independent store there
   * would desync it from the facade above. Typed without `setState` so a consumer cannot bypass
   * the version-dedup guard or the once-per-frame notify contract those three methods above
   * enforce — every write goes through `applyStateFrame`/`applyPacingFrame`/`setLiveness`, never
   * this field.
   */
  readonly readonlyApi: Pick<StoreApi<StoreState>, "getState" | "getInitialState" | "subscribe">;
}

export function createGameStore(): GameStore {
  const api = createStore<StoreState>(() => INITIAL_STATE);

  function applyStateFrame(frame: StateFrame): void {
    const current = api.getState();
    if (current.worldVersion !== null && frame.worldVersion <= current.worldVersion) return;

    const mergedSlices = replaceEqualDeep(current.slices, { ...current.slices, ...frame.slices });
    api.setState({ ...current, slices: mergedSlices, worldVersion: frame.worldVersion });
  }

  function applyPacingFrame(frame: PacingFrame): void {
    const current = api.getState();
    const mergedPacing = replaceEqualDeep(current.pacing, frame);
    api.setState({ ...current, pacing: mergedPacing });
  }

  function setLiveness(liveness: Liveness): void {
    api.setState({ ...api.getState(), liveness });
  }

  return {
    applyStateFrame,
    applyPacingFrame,
    setLiveness,
    subscribe: (listener) => api.subscribe(listener),
    getSnapshot: () => api.getState(),
    readonlyApi: api,
  };
}
