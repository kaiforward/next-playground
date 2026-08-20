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
  /** The cause of a hard tick-pause (`TickFailedMsg.error`, spec §4) — `null` until a tick fails.
   *  Set only by `setTickFailed`, alongside `liveness: "paused"`, so a paused-because-of-failure
   *  reading is always one commit, never a race between two separate fields. */
  failureCause: string | null;
  /** The most recent autosave failure surfaced to the player (spec §5's "surfaced to the player,
   *  not swallowed to the console") — `null` once a save has since succeeded. Independent of
   *  `liveness`: an autosave can fail while the game is otherwise live. */
  autosaveFailure: string | null;
  /**
   * The replacement-epoch floor (spec §8) — `null` outside a world replacement; while set,
   * `applyStateFrame` drops any frame whose `worldVersion` is at or below it, independently of
   * `worldVersion` itself. Needed because `worldVersion` does double duty as both the freshness
   * guard AND the no-world sentinel: `beginWorldReplacement` resets `worldVersion` to `0`, but the
   * WORLD-STORE's own version counter (`lib/world/store.ts`) is monotonic and never resets, so a
   * frame from the OUTGOING world — already in flight on the postMessage channel when the swap
   * command commits, since the tick loop keeps broadcasting right up to that point — still carries
   * a real `worldVersion > 0` and would otherwise sail past the freshness check (`frame.worldVersion
   * <= 0` is false for any such frame). `beginWorldReplacement` latches this to the pre-reset
   * `worldVersion` (the highest version any stale in-flight frame could possibly carry); the first
   * frame whose `worldVersion` exceeds the floor is by construction the NEW world's frame — the
   * worker's version counter climbs monotonically across a replacement (Task 5) — and clears it.
   */
  replacementFloor: number | null;
}

const INITIAL_STATE: StoreState = {
  slices: {},
  worldVersion: null,
  pacing: null,
  liveness: "no-world",
  failureCause: null,
  autosaveFailure: null,
  replacementFloor: null,
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
   *
   * A frame at or below the `replacementFloor` (see that field's own docstring) is ALSO dropped —
   * a stale in-flight frame from the world a replacement is discarding, not merely an out-of-order
   * one — so a swap window never transiently re-merges the outgoing world's slices or resurrects
   * its liveness before the new world's own frame lands.
   */
  applyStateFrame(frame: StateFrame): void;
  /**
   * Merges `frame` into the held pacing state via `replaceEqualDeep` and always notifies —
   * pacing frames carry no version to de-duplicate against, and every posted pacing frame is by
   * definition a new pacing observation (tick advanced, speed changed, or achievedTps recomputed).
   */
  applyPacingFrame(frame: PacingFrame): void;
  setLiveness(liveness: Liveness): void;
  /**
   * Records a hard tick-pause's cause and flips liveness to `"paused"` in one commit (spec §4) —
   * a tick failure is one observable event, never two separate notifications for cause and
   * liveness.
   */
  setTickFailed(cause: string): void;
  /** Records (or clears, via `null`) the most recent autosave failure (spec §5, §11 pagehide). */
  setAutosaveFailure(message: string | null): void;
  /**
   * The world-replacement reset (spec §8) — drops every held slice back to empty and resets
   * `worldVersion` to `0`, the worker's own no-world sentinel (`noWorldStateFrame`,
   * `client/worker/game-worker.ts`) rather than `null`: `null` means "boot hasn't produced a first
   * frame yet" (`RouteBody`, `client/main.tsx`, renders its boot-loading state on that value alone),
   * and a mid-game world replacement must NOT be indistinguishable from a cold boot — the start
   * screen (already mounted; that's who calls this) has to stay mounted and keep rendering its own
   * pending state, not get torn down into a generic "Booting…" screen. `0` reads exactly like a
   * fresh world-less worker to every other consumer (`useAtlas` and friends already default through
   * `EMPTY_ATLAS` etc.) while leaving `RouteBody`'s "first frame ever" check alone. Flips liveness to
   * `"no-world"` and resets `pacing` in the same commit — the outgoing world's tick/speed readout is
   * exactly as stale as its slices once a replacement is in flight. Called synchronously the instant
   * a newGame/loadGame command is dispatched (`lib/hooks/use-game-lifecycle.ts`) so any read during
   * the swap window — before the new world's own full frame lands — gets the defined no-world
   * default rather than the outgoing world's stale slices. Also latches `replacementFloor` to the
   * pre-reset `worldVersion` (see that field's docstring) — `worldVersion: 0` alone is not enough to
   * keep the swap window clean, because a frame from the OUTGOING world can still be in flight on
   * the postMessage channel when this fires, and its real `worldVersion` (> 0) would otherwise pass
   * straight through `applyStateFrame`'s freshness check against the reset `0`.
   */
  beginWorldReplacement(): void;
  /**
   * Cancels an in-flight world replacement — the failure path `beginWorldReplacement()` itself
   * cannot cover: a `newGame`/`loadGame` command (or the dev worker-graph-edit restore,
   * `client/worker-connection.ts`'s `restoreFromDevReloadMarkerIfPending`) dispatched right after
   * `beginWorldReplacement()` that then rejects or resolves `ok: false` (a bad save name, a corrupt
   * or missing autosave, a validation failure) leaves `replacementFloor` latched forever — nothing
   * will ever post a frame past it, so `selectIsReplacing` would stay `true` and the route gate
   * would sit on its boot-loading render indefinitely instead of falling back to the ordinary
   * no-world state (spec §3's `/start` redirect). The store is ALREADY in coherent no-world state
   * from `beginWorldReplacement()` (empty slices, `worldVersion: 0`, `liveness: "no-world"`) — this
   * only needs to drop the floor so `applyStateFrame`'s guard and `selectIsReplacing` stop treating
   * a replacement as still in flight.
   */
  cancelWorldReplacement(): void;
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
    if (current.replacementFloor !== null && frame.worldVersion <= current.replacementFloor) return;

    const mergedSlices = replaceEqualDeep(current.slices, { ...current.slices, ...frame.slices });
    api.setState({
      ...current,
      slices: mergedSlices,
      worldVersion: frame.worldVersion,
      // Any frame that reaches this point already cleared the floor check above, so it is by
      // construction the first frame newer than the outgoing world's highest possible in-flight
      // version — the new world's own frame. Clear the floor in the same commit.
      replacementFloor: null,
    });
  }

  function applyPacingFrame(frame: PacingFrame): void {
    const current = api.getState();
    const mergedPacing = replaceEqualDeep(current.pacing, frame);
    api.setState({ ...current, pacing: mergedPacing });
  }

  function setLiveness(liveness: Liveness): void {
    api.setState({ ...api.getState(), liveness });
  }

  function setTickFailed(cause: string): void {
    api.setState({ ...api.getState(), liveness: "paused", failureCause: cause });
  }

  function setAutosaveFailure(message: string | null): void {
    api.setState({ ...api.getState(), autosaveFailure: message });
  }

  function beginWorldReplacement(): void {
    const current = api.getState();
    api.setState({
      slices: {},
      worldVersion: 0,
      pacing: null,
      liveness: "no-world",
      failureCause: null,
      autosaveFailure: null,
      // The floor is the pre-reset worldVersion — the highest version any frame still in flight
      // from the OUTGOING world could possibly carry. `current.worldVersion ?? 0`, NOT bare
      // `current.worldVersion`: a caller invoking this before boot has ever produced a first frame
      // (`worldVersion: null` — the dev worker-graph-edit restore, `client/worker-connection.ts`'s
      // `restoreFromDevReloadMarkerIfPending`, calls this immediately after posting `subscribe`,
      // before any frame has landed) has no outgoing world either, but STILL needs a floor: the
      // worker's own world-less `{worldVersion: 0}` subscribe reply is about to arrive, and without
      // a floor here `replacementFloor` stays `null` — `selectIsReplacing` reads `null` as "not
      // replacing", so the route gate sees `worldVersion: 0` with nothing in flight and redirects to
      // `/start` before the real load's frame lands (the exact bug this comment used to argue could
      // not happen: "null... needs no floor" was true for every OTHER caller, which always has a
      // real world running, but false for this one). Floor `0` costs nothing extra: the world-less
      // frame is already dropped by the version-equality guard above regardless of the floor, and
      // `0` still latches `replacementFloor !== null` so `isReplacing` stays true until the loaded
      // world's own frame (version >= 1) clears it.
      replacementFloor: current.worldVersion ?? 0,
    });
  }

  function cancelWorldReplacement(): void {
    api.setState({ ...api.getState(), replacementFloor: null });
  }

  return {
    applyStateFrame,
    applyPacingFrame,
    setLiveness,
    setTickFailed,
    setAutosaveFailure,
    beginWorldReplacement,
    cancelWorldReplacement,
    subscribe: (listener) => api.subscribe(listener),
    getSnapshot: () => api.getState(),
    readonlyApi: api,
  };
}

/**
 * Whether a world replacement is in flight — a `useGameSlice`-ready selector over `replacementFloor`
 * (see that field's own docstring) rather than a raw field read, so every consumer names the SAME
 * derived fact instead of re-deriving `replacementFloor !== null` at each call site. The route gate
 * (`client/routes.ts`'s `resolveRouteGate`/`shouldRedirectToStart`) reads this to distinguish the
 * swap window — `worldVersion === 0` but a new world is already on the way — from a genuine no-world
 * boot, which must still redirect to `/start` (Gate C smoke finding: without this distinction, New
 * Game navigated to the map route and was immediately redirected straight back to `/start`, because
 * the command result — and the mutation's own `navigate()` call — resolves before the new world's
 * state frame is even built, let alone posted).
 */
export function selectIsReplacing(state: StoreState): boolean {
  return state.replacementFloor !== null;
}
