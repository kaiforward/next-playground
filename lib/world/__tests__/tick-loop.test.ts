import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { TickLoop, type TickBroadcast } from "@/lib/world/tick-loop";
import { generateWorld } from "@/lib/world/gen";
import { getWorld, setWorld, clearWorld } from "@/lib/world/store";
import { setSavesDirForTesting, AUTOSAVE_NAME } from "@/lib/world/save-files";

let savesDir: string;
let loop: TickLoop;

beforeAll(async () => {
  savesDir = await mkdtemp(path.join(tmpdir(), "tick-loop-saves-"));
  setSavesDirForTesting(savesDir);
});

beforeEach(() => {
  setWorld(generateWorld({ systemCount: 60, seed: 7 }));
  loop = new TickLoop();
});

afterEach(() => {
  loop.stop();
  clearWorld();
  vi.useRealTimers();
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
});
