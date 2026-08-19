/**
 * In-process tick loop — paces `runWorldTick` against the world store and
 * broadcasts tick results to subscribers (the SSE route).
 *
 * Wall-clock APIs (`Date.now`, `setInterval`, `setTimeout`) are used for
 * pacing, broadcast throttling, and autosave cadence only — never inside
 * tick math, which stays deterministic in `runWorldTick`. Host-portable by
 * requirement: this module runs under Node AND in the browser game worker,
 * so no Node-only globals (`setImmediate` was one, once).
 * Disk access (autosave) goes through a dynamic import of `save-files.ts`
 * so this module's static graph stays free of Node-edge dependencies.
 *
 * Singleton: `tickLoop` is globalThis-cached (same idiom as the world
 * store) so dev-server module reloads don't spawn parallel loops.
 */

import { getWorld, getWorldVersion, hasWorld, setWorld } from "./store";
import { AUTOSAVE_NAME } from "./save";
import { runWorldTick } from "./tick";
import type { GlobalEventMap } from "@/lib/tick/types";
import type { World } from "./types";

export type Speed = "paused" | 1 | 5 | "max";

/** One SSE frame: tick position, pacing state, and the tick's global events. `error` is present
 *  ONLY on the hard-pause-on-failure emit (`tickOnce`'s catch block below) — every other emit
 *  omits the field entirely, so a consumer can tell "paused because the player paused" from
 *  "paused because a tick threw" without a second channel (client-runtime spec §4: the worker
 *  surfaces this as a `tickFailed` message alongside the pause pacing frame). */
export interface TickBroadcast {
  currentTick: number;
  speed: Speed;
  achievedTps: number;
  events: Partial<GlobalEventMap>;
  error?: string;
}

/**
 * Latest-wins broadcast throttle: at most 4 emits/sec so "max" speed can't melt SSE clients.
 *
 * **A client must never count broadcasts to count anything.** This is latest-wins, not a queue — a
 * frame arriving inside the window replaces the pending one rather than merging with it, so frames
 * are dropped by design and the drop rate rises with speed. Anything periodic the payload carries is
 * rarer still: the economy cycle resolves on one tick in `CYCLE_LENGTH`, so at speed a whole cycle,
 * boundary frame included, can vanish inside a single window. A consumer counting edges then stalls
 * silently, which is the worst shape of wrong — it looks like nothing is happening.
 *
 * Derive from the monotonic `currentTick` instead. Every frame that does arrive overwrites it, so it
 * is correct however many were lost, and floor-dividing it answers "which cycle is the world in"
 * without being able to miss one.
 */
const BROADCAST_MIN_INTERVAL_MS = 250;
/** At "max", run ticks for this long, then yield the event loop so HTTP requests get served. */
const MAX_SPEED_BUDGET_MS = 50;
const AUTOSAVE_INTERVAL_MS = 60_000;
const TPS_WINDOW_MS = 1_000;

export class TickLoop {
  private speed: Speed = "paused";
  private interval: ReturnType<typeof setInterval> | null = null;
  /** Bumped to cancel an in-flight max-speed loop when pacing changes. */
  private maxToken = 0;
  /** Re-entrancy guard: a paced interval firing mid-tick skips instead of overlapping. */
  private ticking = false;
  /** In-flight guard for autosave: a save already writing skips instead of overlapping. */
  private saving = false;
  /** The most recent autosave's write chain — awaitable for graceful shutdown / tests. */
  private savePromise: Promise<void> = Promise.resolve();
  private subscribers = new Set<(e: TickBroadcast) => void>();
  private tickTimestamps: number[] = [];
  private lastEmitAt = 0;
  private pendingBroadcast: TickBroadcast | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAutosaveAt = 0;
  /**
   * Commands queued while a tick is in flight — each entry closes over its own `run`,
   * `resolve`/`reject`, so the queue itself stays a plain array of niladic thunks
   * regardless of what `T` any individual command resolves with. Drained in
   * `drainCommands`, never applied inside `tickOnce`'s await window.
   */
  private commandQueue: (() => void)[] = [];

  getSpeed(): Speed {
    return this.speed;
  }

  /** Completed ticks in the trailing one-second window. */
  getAchievedTps(): number {
    const cutoff = Date.now() - TPS_WINDOW_MS;
    this.tickTimestamps = this.tickTimestamps.filter((t) => t > cutoff);
    return this.tickTimestamps.length;
  }

  /** Current state framed as a broadcast — sent to SSE clients on connect. */
  getSnapshot(): TickBroadcast {
    return {
      currentTick: hasWorld() ? getWorld().meta.currentTick : 0,
      speed: this.speed,
      achievedTps: this.getAchievedTps(),
      events: {},
    };
  }

  setSpeed(speed: Speed): void {
    if (speed === this.speed) return;
    const wasPaused = this.speed === "paused";
    this.stopPacing();
    this.speed = speed;
    if (speed === "paused") {
      this.autosave();
    } else if (wasPaused) {
      // Autosave cadence counts from resume, not from the last pause's save.
      this.lastAutosaveAt = Date.now();
    }
    if (speed === "max") {
      void this.runMaxLoop(this.maxToken);
    } else if (typeof speed === "number") {
      this.interval = setInterval(() => {
        void this.tickOnce();
      }, 1000 / speed);
    }
    this.emit(this.getSnapshot(), true);
  }

  /**
   * Queues `run` against the last committed world and resolves with its result plus the
   * world version it committed at. `runWorldTick` is async (`tickOnce` below reads the
   * world before its `await` and writes after), so a command applied mid-tick would be
   * silently overwritten by the tick's own `setWorld` — commands therefore only ever run
   * between ticks. While a tick is in flight this just queues; `tickOnce`'s `finally`
   * drains the queue right after that tick's own commit, so a command queued during the
   * await window applies AFTER the tick and is never the thing that gets overwritten.
   * When no tick is in flight (paused, or between an interval's fires) the queue drains
   * synchronously, inside this same call, so a paused command is never left waiting on a
   * tick that will never come.
   *
   * Each queued command commits with its own `setWorld` — draining N queued commands
   * bumps the world version N times rather than once. That is deliberate, not merely
   * cheap: the "once per committed world version" notify contract (spec §2) is per
   * version, not per drain, so N commits notifying N times is within contract; the reason
   * to pick per-command commits over a single end-of-drain commit is that the SECOND of
   * two rapid commands must read the FIRST's committed output, not the pre-drain world —
   * the silent-revert kill this task exists to close. A single end-of-drain commit would
   * let every command in the batch read the same stale pre-drain world.
   *
   * A throwing `run` rejects only its own promise. The world stays at its last good
   * committed state (the throw happens before this command's `setWorld`), the loop keeps
   * ticking, and every command queued after the failing one still runs — against that
   * last good state.
   */
  enqueueCommand<T>(
    run: (world: World) => { world: World; result: T },
  ): Promise<{ result: T; worldVersion: number }> {
    return new Promise((resolve, reject) => {
      this.commandQueue.push(() => {
        try {
          const { world, result } = run(getWorld());
          setWorld(world);
          resolve({ result, worldVersion: getWorldVersion() });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      if (!this.ticking) this.drainCommands();
    });
  }

  /** Runs every queued command in commit order, each against whatever the previous one
   *  (or the tick that preceded this drain) just committed. Called from `enqueueCommand`
   *  when no tick is in flight, and from `tickOnce`'s `finally` once that tick's own
   *  `setWorld` has run — never from inside `runWorldTick`'s await window. */
  private drainCommands(): void {
    while (this.commandQueue.length > 0) {
      const command = this.commandQueue.shift();
      command?.();
    }
  }

  subscribe(fn: (e: TickBroadcast) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** Hard teardown (tests, shutdown): stop pacing without autosaving or emitting. */
  stop(): void {
    this.stopPacing();
    this.speed = "paused";
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingBroadcast = null;
  }

  private stopPacing(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.maxToken += 1;
  }

  private async tickOnce(): Promise<void> {
    if (this.ticking || !hasWorld()) return;
    this.ticking = true;
    try {
      const { world, events } = await runWorldTick(getWorld());
      setWorld(world);
      this.tickTimestamps.push(Date.now());
      if (this.speed !== "paused" && Date.now() - this.lastAutosaveAt >= AUTOSAVE_INTERVAL_MS) {
        this.autosave();
      }
      this.emit(
        {
          currentTick: world.meta.currentTick,
          speed: this.speed,
          achievedTps: this.getAchievedTps(),
          events: events.events,
        },
        false,
      );
    } catch (error) {
      // Pause rather than spin on a failing tick. No autosave — don't
      // overwrite the last good save with state from a broken tick.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[tick-loop] tick failed — pausing:", error);
      this.stopPacing();
      this.speed = "paused";
      this.emit({ ...this.getSnapshot(), error: message }, true);
    } finally {
      this.ticking = false;
      // Drain anything queued during the await window above — after this tick's own
      // `setWorld` (success path) or its no-op-on-world (failure path), never inside it.
      this.drainCommands();
    }
  }

  private async runMaxLoop(token: number): Promise<void> {
    while (this.speed === "max" && this.maxToken === token) {
      const budgetEnd = Date.now() + MAX_SPEED_BUDGET_MS;
      do {
        await this.tickOnce();
      } while (this.speed === "max" && this.maxToken === token && Date.now() < budgetEnd);
      // setTimeout(0), not setImmediate: the loop runs in the browser worker too, where
      // setImmediate does not exist. The point is only to yield to the event loop between
      // budget windows so queued messages and timers get a turn.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  private emit(broadcast: TickBroadcast, bypassThrottle: boolean): void {
    const now = Date.now();
    const elapsed = now - this.lastEmitAt;
    if (bypassThrottle || elapsed >= BROADCAST_MIN_INTERVAL_MS) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.pendingBroadcast = null;
      this.lastEmitAt = now;
      for (const fn of this.subscribers) fn(broadcast);
      return;
    }
    // Inside the throttle window: hold the latest broadcast and flush it
    // when the window reopens (so a burst still ends on fresh state).
    this.pendingBroadcast = broadcast;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const pending = this.pendingBroadcast;
        if (!pending) return;
        this.pendingBroadcast = null;
        this.lastEmitAt = Date.now();
        for (const fn of this.subscribers) fn(pending);
      }, BROADCAST_MIN_INTERVAL_MS - elapsed);
    }
  }

  private autosave(): void {
    if (!hasWorld() || this.saving) return;
    this.saving = true;
    this.lastAutosaveAt = Date.now();
    const world = getWorld();
    this.savePromise = import("./save-files")
      .then(({ writeSave }) => writeSave(AUTOSAVE_NAME, world))
      .catch((error) => console.error("[tick-loop] autosave failed:", error))
      .finally(() => {
        this.saving = false;
      });
  }

  /**
   * Resolves once the most recent autosave's write has settled. The pause /
   * cadence autosave is otherwise fire-and-forget; await this before shutdown
   * (or between tests) so an in-flight write can't outlive its trigger.
   */
  async whenAutosaveSettled(): Promise<void> {
    await this.savePromise;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __tickLoop: TickLoop | undefined;
}

const globalStore: { __tickLoop?: TickLoop } = globalThis;
export const tickLoop: TickLoop = (globalStore.__tickLoop ??= new TickLoop());
