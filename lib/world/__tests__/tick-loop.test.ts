import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { TickLoop, type TickBroadcast } from "@/lib/world/tick-loop";
import { generateWorld } from "@/lib/world/gen";
import { getWorld, setWorld, clearWorld } from "@/lib/world/store";
import { setSavesDirForTesting, writeSave } from "@/lib/world/save-files";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import { runWorldTick } from "@/lib/world/tick";

// Wraps the real implementations in a `vi.fn` so most tests exercise genuine
// tick/save behaviour (the default, calling `actual`), while the error-path
// and re-entrancy tests below override individual calls with
// `mockRejectedValueOnce`/`mockImplementationOnce`.
vi.mock("@/lib/world/tick", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/world/tick")>();
  return { ...actual, runWorldTick: vi.fn(actual.runWorldTick) };
});

vi.mock("@/lib/world/save-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/world/save-files")>();
  return { ...actual, writeSave: vi.fn(actual.writeSave) };
});

let savesDir: string;
let loop: TickLoop;

beforeAll(async () => {
  savesDir = await mkdtemp(path.join(tmpdir(), "tick-loop-saves-"));
  setSavesDirForTesting(savesDir);
});

beforeEach(async () => {
  // Only clears call history (not the wrapped implementations above), so
  // each test starts from a clean call count without losing the passthrough.
  vi.clearAllMocks();
  // Every test writes the same AUTOSAVE_NAME file in the shared dir. Remove any
  // leftover from a prior test so a file-reading assertion (vi.waitFor) can only
  // ever observe this test's own autosave (retrying while absent) rather than a
  // stale higher-tick file racing the current write.
  await rm(path.join(savesDir, `${AUTOSAVE_NAME}.json`), { force: true });
  setWorld(generateWorld({ systemCount: 60, seed: 7 }));
  loop = new TickLoop();
});

afterEach(async () => {
  loop.stop();
  // The pause/cadence autosave is fire-and-forget; wait for it to settle so a
  // slow write can't land in the shared saves dir during the next test and
  // race its autosave (all tests write the same AUTOSAVE_NAME file).
  vi.useRealTimers();
  await loop.whenAutosaveSettled();
  clearWorld();
});

describe("TickLoop", () => {
  it("starts paused and does not tick", async () => {
    vi.useFakeTimers();
    expect(loop.getSpeed()).toBe("paused");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWorld().meta.currentTick).toBe(0);
  });

  it("setSpeed(1) advances the world via runWorldTick on an interval", async () => {
    vi.useFakeTimers();
    loop.setSpeed(1);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(getWorld().meta.currentTick).toBeGreaterThanOrEqual(2);
  });

  it("setSpeed('paused') stops ticking", async () => {
    vi.useFakeTimers();
    loop.setSpeed(1);
    await vi.advanceTimersByTimeAsync(2_100);
    loop.setSpeed("paused");
    const tickAtPause = getWorld().meta.currentTick;
    expect(tickAtPause).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWorld().meta.currentTick).toBe(tickAtPause);
  });

  it("subscribers receive TickBroadcast-shaped events", async () => {
    vi.useFakeTimers();
    const received: TickBroadcast[] = [];
    loop.subscribe((e) => received.push(e));
    loop.setSpeed(1);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(received.length).toBeGreaterThanOrEqual(1);
    for (const broadcast of received) {
      expect(typeof broadcast.currentTick).toBe("number");
      expect(["paused", 1, 5, "max"]).toContain(broadcast.speed);
      expect(typeof broadcast.achievedTps).toBe("number");
      expect(typeof broadcast.events).toBe("object");
    }
  });

  it("emits immediately on speed change, even while paused", () => {
    const received: TickBroadcast[] = [];
    loop.subscribe((e) => received.push(e));
    loop.setSpeed(5);
    loop.setSpeed("paused");
    expect(received.map((e) => e.speed)).toEqual([5, "paused"]);
  });

  it("unsubscribe stops delivery", async () => {
    vi.useFakeTimers();
    const received: TickBroadcast[] = [];
    const unsubscribe = loop.subscribe((e) => received.push(e));
    loop.setSpeed(1);
    await vi.advanceTimersByTimeAsync(1_100);
    const countAtUnsubscribe = received.length;
    unsubscribe();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(received.length).toBe(countAtUnsubscribe);
  });

  // Real timers: the max loop's tick budget reads Date.now(), which is frozen
  // under fake timers (the budget window would never elapse).
  it("at 'max', ticks increase monotonically and the loop yields the event loop", async () => {
    const received: TickBroadcast[] = [];
    loop.subscribe((e) => received.push(e));
    loop.setSpeed("max");
    // Both awaits resolving while max is running proves the loop yields.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    loop.setSpeed("paused");
    expect(getWorld().meta.currentTick).toBeGreaterThan(0);
    const ticks = received.map((e) => e.currentTick);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]);
    }
  });

  it("throttles broadcasts to at most ~4/sec at max speed", async () => {
    const received: TickBroadcast[] = [];
    loop.subscribe((e) => received.push(e));
    loop.setSpeed("max");
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    loop.setSpeed("paused");
    const tickEmits = received.filter((e) => e.speed === "max").length;
    const ticksRun = getWorld().meta.currentTick;
    // Only meaningful if the machine ran more ticks than the emit cap.
    if (ticksRun > 8) {
      expect(tickEmits).toBeLessThanOrEqual(8);
    }
  });

  it("autosaves on transition to paused", async () => {
    loop.setSpeed(5);
    await vi.waitFor(() => {
      expect(getWorld().meta.currentTick).toBeGreaterThan(0);
    });
    loop.setSpeed("paused");
    const savedTick = getWorld().meta.currentTick;
    await vi.waitFor(async () => {
      const raw = await readFile(path.join(savesDir, `${AUTOSAVE_NAME}.json`), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.world.meta.currentTick).toBe(savedTick);
    });
  });

  it("getSnapshot reflects current tick and speed", async () => {
    vi.useFakeTimers();
    loop.setSpeed(1);
    await vi.advanceTimersByTimeAsync(2_100);
    const snapshot = loop.getSnapshot();
    expect(snapshot.currentTick).toBe(getWorld().meta.currentTick);
    expect(snapshot.speed).toBe(1);
    expect(snapshot.events).toEqual({});
  });

  it("pauses, stops pacing, skips autosave, and still emits a snapshot when a tick fails", async () => {
    vi.useFakeTimers();
    vi.mocked(runWorldTick).mockRejectedValueOnce(new Error("boom"));
    const received: TickBroadcast[] = [];
    loop.subscribe((e) => received.push(e));

    loop.setSpeed(1);
    await vi.advanceTimersByTimeAsync(1_100);

    expect(loop.getSpeed()).toBe("paused");
    expect(getWorld().meta.currentTick).toBe(0);
    expect(vi.mocked(writeSave)).not.toHaveBeenCalled();
    expect(received.at(-1)?.speed).toBe("paused");

    // Pacing is stopped: further elapsed time doesn't run more ticks.
    const callsAfterFailure = vi.mocked(runWorldTick).mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWorld().meta.currentTick).toBe(0);
    expect(vi.mocked(runWorldTick)).toHaveBeenCalledTimes(callsAfterFailure);
  });

  it("skips an overlapping tickOnce instead of double-applying it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(runWorldTick).mockImplementationOnce(async (world) => {
      await gate;
      return {
        world: { ...world, meta: { ...world.meta, currentTick: world.meta.currentTick + 1 } },
        events: { currentTick: world.meta.currentTick + 1, events: {} },
        markets: [],
        instrumentation: {},
      };
    });

    // Real timers: precise pause control on an indefinitely-pending mock
    // doesn't play well with fake-timer microtask flushing (see the "at
    // 'max'" test above for the same tradeoff).
    loop.setSpeed(5); // 200ms interval — two fires should land before we release the gate.
    await new Promise<void>((resolve) => setTimeout(resolve, 450));
    expect(vi.mocked(runWorldTick)).toHaveBeenCalledTimes(1);

    release();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(getWorld().meta.currentTick).toBe(1);
  });

  describe("enqueueCommand", () => {
    it("applies a command immediately when the loop is paused, bumping the world version", async () => {
      const beforeVersion = getWorld().meta.currentTick; // sanity: world starts at tick 0
      expect(beforeVersion).toBe(0);

      const promise = loop.enqueueCommand((world) => ({
        world: { ...world, meta: { ...world.meta, currentTick: 999 } },
        result: "ok",
      }));

      // No await/advance needed: paused enqueue drains synchronously inside enqueueCommand.
      expect(getWorld().meta.currentTick).toBe(999);
      const { result, worldVersion } = await promise;
      expect(result).toBe("ok");
      expect(worldVersion).toBeGreaterThan(0);
    });

    it("a command enqueued during a tick's await window applies AFTER that tick and is not overwritten", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(runWorldTick).mockImplementationOnce(async (world) => {
        await gate;
        return {
          world: { ...world, meta: { ...world.meta, currentTick: world.meta.currentTick + 1 } },
          events: { currentTick: world.meta.currentTick + 1, events: {} },
          markets: [],
          instrumentation: {},
        };
      });

      loop.setSpeed(5); // 200ms interval
      await new Promise<void>((resolve) => setTimeout(resolve, 250)); // tick started, awaiting the gate

      const MARKER_MAP_SIZE = -777; // a value world-gen never produces, used purely as a write marker
      const commandPromise = loop.enqueueCommand((world) => ({
        world: { ...world, meta: { ...world.meta, mapSize: MARKER_MAP_SIZE } },
        result: "committed",
      }));

      // Still inside the tick's await window: the command must NOT have applied yet.
      expect(getWorld().meta.mapSize).not.toBe(MARKER_MAP_SIZE);

      release(); // let the tick's own setWorld run
      const { result } = await commandPromise;

      expect(result).toBe("committed");
      // The tick's setWorld ran first (currentTick bumped to 1); the command's write
      // rode on top of it rather than being silently reverted by it.
      expect(getWorld().meta.currentTick).toBe(1);
      expect(getWorld().meta.mapSize).toBe(MARKER_MAP_SIZE);
    });

    it("two rapid commands queued together apply in order, the second reading the first's committed state", async () => {
      // Both must land in the SAME drain batch (the actual silent-revert hazard) rather than
      // each triggering its own separate immediate drain — queue them while a tick is in
      // flight so they both sit in the queue until one shared `drainCommands` call runs.
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(runWorldTick).mockImplementationOnce(async (world) => {
        await gate;
        return {
          world,
          events: { currentTick: world.meta.currentTick, events: {} },
          markets: [],
          instrumentation: {},
        };
      });

      loop.setSpeed(5); // 200ms interval
      await new Promise<void>((resolve) => setTimeout(resolve, 250)); // tick started, awaiting the gate

      const first = loop.enqueueCommand((world) => ({
        world: { ...world, meta: { ...world.meta, currentTick: world.meta.currentTick + 1 } },
        result: world.meta.currentTick,
      }));
      const second = loop.enqueueCommand((world) => ({
        world: { ...world, meta: { ...world.meta, currentTick: world.meta.currentTick + 1 } },
        result: world.meta.currentTick,
      }));

      release(); // tick commits (currentTick unchanged by the tick itself), then both commands drain together
      const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
      loop.setSpeed("paused");

      // First read the post-tick committed tick (0, since this tick leaves it unchanged);
      // second read first's committed output (1) — never a revert to the pre-drain value.
      expect(firstOutcome.result).toBe(0);
      expect(secondOutcome.result).toBe(1);
      expect(secondOutcome.worldVersion).toBeGreaterThan(firstOutcome.worldVersion);
      expect(getWorld().meta.currentTick).toBe(2);
    });

    it("a throwing command rejects its own promise without pausing the loop or corrupting the world", async () => {
      const tickBefore = getWorld().meta.currentTick;

      // Queue the failing command together with a good one in the SAME drain batch (during a
      // tick's await window, so both accumulate before either runs) — a throw must not abort
      // the rest of that batch.
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(runWorldTick).mockImplementationOnce(async (world) => {
        await gate;
        return {
          world,
          events: { currentTick: world.meta.currentTick, events: {} },
          markets: [],
          instrumentation: {},
        };
      });
      loop.setSpeed(5); // 200ms interval
      await new Promise<void>((resolve) => setTimeout(resolve, 250)); // tick started, awaiting the gate

      const failing = loop.enqueueCommand<string>(() => {
        throw new Error("bad command");
      });
      const batchmate = loop.enqueueCommand((world) => ({
        world: { ...world, meta: { ...world.meta, currentTick: world.meta.currentTick + 1 } },
        result: "batchmate-ok",
      }));
      release(); // tick commits, then the batch (failing, then batchmate) drains together

      await expect(failing).rejects.toThrow("bad command");
      const batchmateOutcome = await batchmate;
      expect(batchmateOutcome.result).toBe("batchmate-ok");
      loop.setSpeed("paused");

      // World untouched by the throwing command; the batchmate's write did land.
      expect(getWorld().meta.currentTick).toBe(tickBefore + 1);

      // The loop is unaffected: still paused (not hard-paused-by-error state confused with
      // normal paused), and a later command still applies against the last good world.
      expect(loop.getSpeed()).toBe("paused");
      const followUp = await loop.enqueueCommand((world) => ({
        world: { ...world, meta: { ...world.meta, currentTick: world.meta.currentTick + 1 } },
        result: "fine",
      }));
      expect(followUp.result).toBe("fine");
      expect(getWorld().meta.currentTick).toBe(tickBefore + 2);

      // And the loop still ticks normally afterward.
      vi.useFakeTimers();
      const tickBeforeResume = getWorld().meta.currentTick;
      loop.setSpeed(1);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(getWorld().meta.currentTick).toBeGreaterThan(tickBeforeResume);
    });
  });
});
