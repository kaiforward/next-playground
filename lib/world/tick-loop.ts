/**
 * In-process tick loop — paces `runWorldTick` against the world store and
 * broadcasts tick results to subscribers (the SSE route).
 *
 * Wall-clock APIs (`Date.now`, `setInterval`, `setTimeout`, `setImmediate`)
 * are used for pacing, broadcast throttling, and autosave cadence only —
 * never inside tick math, which stays deterministic in `runWorldTick`.
 * Disk access (autosave) goes through a dynamic import of `save-files.ts`
 * so this module's static graph stays free of Node-edge dependencies.
 *
 * Singleton: `tickLoop` is globalThis-cached (same idiom as the world
 * store) so dev-server module reloads don't spawn parallel loops.
 */

import { getWorld, hasWorld, setWorld } from "./store";
import { AUTOSAVE_NAME } from "./save";
import { runWorldTick } from "./tick";
import type { GlobalEventMap } from "@/lib/tick/types";

export type Speed = "paused" | 1 | 5 | "max";

/** One SSE frame: tick position, pacing state, and the tick's global events. */
export interface TickBroadcast {
  currentTick: number;
  speed: Speed;
  achievedTps: number;
  events: Partial<GlobalEventMap>;
}

/** Latest-wins broadcast throttle: at most 4 emits/sec so "max" speed can't melt SSE clients. */
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
      console.error("[tick-loop] tick failed — pausing:", error);
      this.stopPacing();
      this.speed = "paused";
      this.emit(this.getSnapshot(), true);
    } finally {
      this.ticking = false;
    }
  }

  private async runMaxLoop(token: number): Promise<void> {
    while (this.speed === "max" && this.maxToken === token) {
      const budgetEnd = Date.now() + MAX_SPEED_BUDGET_MS;
      do {
        await this.tickOnce();
      } while (this.speed === "max" && this.maxToken === token && Date.now() < budgetEnd);
      await new Promise<void>((resolve) => setImmediate(resolve));
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
