import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
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

beforeEach(() => {
  // Only clears call history (not the wrapped implementations above), so
  // each test starts from a clean call count without losing the passthrough.
  vi.clearAllMocks();
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
});
