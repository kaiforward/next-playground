import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { createGameWorker, type InboundMessage, type OutboundMessage, type GameCommandEnvelope } from "@/client/worker/game-worker";
import { createFakeWorkerScope } from "@/client/worker/host";
import type { BootConfig } from "@/lib/runtime/channel";

import { tickLoop } from "@/lib/world/tick-loop";
import { getWorld, getWorldVersion, clearWorld } from "@/lib/world/store";
import { buildStateFrame } from "@/lib/runtime/snapshot";
import { createGameStore } from "@/lib/store/game-store";
import { setSavesDirForTesting } from "@/lib/world/save-files";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import { runWorldTick } from "@/lib/world/tick";

// Same idiom as lib/world/__tests__/tick-loop.test.ts: wrap the real implementation in a `vi.fn`
// so most tests exercise genuine tick behaviour, while the failing-tick test overrides one call.
vi.mock("@/lib/world/tick", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/world/tick")>();
  return { ...actual, runWorldTick: vi.fn(actual.runWorldTick) };
});

const BOOT_CONFIG: BootConfig = { economyScale: 1, debugEconomy: false, debugEvents: false };
const SMALL_NEW_GAME = {
  systemCount: 50,
  seed: 42,
  name: "Worker Test Seat",
  governmentType: "federation",
  doctrine: "mercantile",
} as const;

type FakeScope = ReturnType<typeof createFakeWorkerScope<InboundMessage, OutboundMessage>>;

/**
 * Polls the worker with a cheap, always-answerable command (`listSaves`, valid world-less) until a
 * `commandResult` for that probe comes back `ok: true` — the only externally-observable signal that
 * `handleBoot`'s dynamic-import chain has resolved (pre-boot, every command replies immediately
 * with `"Worker not booted."`, so a probe reply is the boot completion signal itself, not a timing
 * guess).
 *
 * At most ONE probe is ever in flight: a poll sends a fresh probe only when the previous one has
 * already settled (tracked via `pending`), and the function returns only once the probe it is
 * currently tracking has itself settled `ok: true` — never on an earlier probe's success while a
 * later one is still outstanding. This closes two real failures this suite hit while developing
 * the helper: (1) a fresh random id sent every poll meant a reply arriving after its own poll's
 * check was never revisited — the check kept moving on to a NEW id instead of rechecking the one
 * it was waiting on; (2) even keyed by a stable id, sending a new probe on every poll regardless of
 * whether the previous one had replied yet left a straggler in flight at the moment the function
 * returned — its reply (and the `pushStateFrame()` every successful command triggers) then landed
 * AFTER a caller's `scope.sent.length = 0`, silently keeping a broken "no post-command state push"
 * red-proof green.
 */
async function waitForBoot(scope: FakeScope): Promise<void> {
  let seq = 0;
  let pending = false;
  await vi.waitFor(() => {
    if (!pending) {
      seq += 1;
      pending = true;
      scope.receive({ type: "command", envelope: { id: `boot-probe-${seq}`, type: "listSaves", payload: null } });
    }
    const reply = scope.sent.find((m) => m.type === "commandResult" && m.id === `boot-probe-${seq}`);
    if (!reply || reply.type !== "commandResult") throw new Error("waiting for the boot probe's reply");
    pending = false;
    if (!reply.result.ok) throw new Error("worker not booted yet");
  });
  // The probe(s) sent above are settled by construction (the loop above only returns once the last
  // one it sent has a reply) — drop their commandResult, and every "state" message accumulated so
  // far (only a SUCCESSFUL command pushes one, so at most the final probe's — nothing else has been
  // sent to this scope yet, since every call site invokes this helper immediately after boot), so a
  // caller's own assertions see only messages its own commands produced. Filtered IN PLACE, never
  // reassigned: `scope.postMessage` closes over the array `createFakeWorkerScope` allocated, not
  // whatever `scope.sent` happens to point at — `scope.sent = scope.sent.filter(...)` would silently
  // detach future messages from the array this function's caller goes on to read.
  const kept = scope.sent.filter(
    (m) => !(m.type === "commandResult" && typeof m.id === "string" && m.id.startsWith("boot-probe-")) && m.type !== "state",
  );
  scope.sent.length = 0;
  scope.sent.push(...kept);
}

async function waitForCommandResult(
  scope: FakeScope,
  id: string,
): Promise<Extract<OutboundMessage, { type: "commandResult" }>> {
  return vi.waitFor(() => {
    const reply = scope.sent.find((m) => m.type === "commandResult" && m.id === id);
    if (!reply || reply.type !== "commandResult") throw new Error(`no commandResult for ${id} yet`);
    return reply;
  });
}

function send(scope: FakeScope, envelope: GameCommandEnvelope): void {
  scope.receive({ type: "command", envelope });
}

/** A stable observable for "is this the same world" without a giant `toEqual` diff on failure —
 *  the world's own current tick plus a content hash of its full JSON. */
function worldHash(): string {
  return createHash("sha256").update(JSON.stringify(getWorld())).digest("hex");
}

let savesDir: string;

beforeAll(async () => {
  savesDir = await mkdtemp(path.join(tmpdir(), "game-worker-saves-"));
  setSavesDirForTesting(savesDir);
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  tickLoop.stop();
  await tickLoop.whenAutosaveSettled();
  clearWorld();
  await rm(path.join(savesDir, `${AUTOSAVE_NAME}.json`), { force: true });
  vi.useRealTimers();
});

describe("createGameWorker — subscribe handshake, world-less", () => {
  it("subscribing to a world-less worker (no boot message at all) returns a defined no-world frame, not silence", () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);

    scope.receive({ type: "subscribe" });

    expect(scope.sent).toHaveLength(2);
    const pacing = scope.sent.find((m) => m.type === "pacing");
    const state = scope.sent.find((m) => m.type === "state");
    if (!pacing || pacing.type !== "pacing") throw new Error("expected a pacing message");
    if (!state || state.type !== "state") throw new Error("expected a state message");

    expect(pacing.frame).toEqual({ currentTick: 0, speed: "paused", achievedTps: 0, events: {} });
    expect(state.frame).toEqual({ worldVersion: 0, slices: {} });
  });

  it("subscribing after boot but before newGame/loadGame still returns the no-world frame", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);
    scope.sent.length = 0;

    scope.receive({ type: "subscribe" });

    const state = scope.sent.find((m) => m.type === "state");
    if (!state || state.type !== "state") throw new Error("expected a state message");
    expect(state.frame).toEqual({ worldVersion: 0, slices: {} });
  });
});

describe("createGameWorker — tick failure", () => {
  it("a failing tick emits TickFailedMsg and the pause pacing frame — never a silent stop", async () => {
    vi.useFakeTimers();
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);

    send(scope, { id: "ng", type: "newGame", payload: SMALL_NEW_GAME });
    await waitForCommandResult(scope, "ng");
    scope.sent.length = 0;

    vi.mocked(runWorldTick).mockRejectedValueOnce(new Error("boom"));
    send(scope, { id: "sp", type: "setSpeed", payload: { speed: 1 } });
    await waitForCommandResult(scope, "sp");

    await vi.advanceTimersByTimeAsync(1_100);

    const failed = scope.sent.find((m) => m.type === "tickFailed");
    if (!failed || failed.type !== "tickFailed") throw new Error("expected a tickFailed message");
    expect(failed.msg.error).toBe("boom");

    const pacingMsgs = scope.sent.filter((m) => m.type === "pacing");
    const lastPacing = pacingMsgs.at(-1);
    if (!lastPacing || lastPacing.type !== "pacing") throw new Error("expected a pacing message");
    expect(lastPacing.frame.speed).toBe("paused");
  });
});

describe("createGameWorker — throttle coalescing", () => {
  it("a burst of ticks inside one throttle window coalesces to a frame whose store-applied result equals the world", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);

    send(scope, { id: "ng", type: "newGame", payload: SMALL_NEW_GAME });
    await waitForCommandResult(scope, "ng");
    scope.sent.length = 0;

    // Real timers: "max" speed's tick budget reads Date.now() (frozen under fake timers) — same
    // constraint lib/world/__tests__/tick-loop.test.ts documents for its own throttle test.
    send(scope, { id: "sp", type: "setSpeed", payload: { speed: "max" } });
    await waitForCommandResult(scope, "sp");
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    send(scope, { id: "stop", type: "setSpeed", payload: { speed: "paused" } });
    await waitForCommandResult(scope, "stop");

    const pacingMsgs = scope.sent.filter((m) => m.type === "pacing" && m.frame.speed === "max");
    const ticksRun = getWorld().meta.currentTick;
    // Anti-flake tradeoff: how many REAL ticks a real wall-clock second yields is machine-dependent,
    // so this half is conditional (skipped on a slow/loaded machine that never cleared 8 ticks) —
    // it demonstrates coalescing happened, but is not the test's core proof. The unconditional half
    // below (apply only the last frame to a real store, compare against a direct snapshot) is: it
    // holds regardless of how many ticks ran or how many broadcasts the throttle let through, and is
    // what "nothing lost to latest-wins" actually asserts.
    if (ticksRun > 8) {
      // The loop throttles broadcasts to ~4/sec (lib/world/tick-loop.ts BROADCAST_MIN_INTERVAL_MS)
      // — strictly fewer pacing messages than ticks that actually ran proves some ticks' frames
      // were coalesced away, not that every tick got its own message.
      expect(pacingMsgs.length).toBeLessThan(ticksRun);
    }
    // Every emitted pacing frame carries per-type event NOTIFICATIONS (a record), never the flat
    // per-tick event list — the real producer's own output, replacing a hand-built literal check.
    for (const msg of pacingMsgs) {
      if (msg.type !== "pacing") continue;
      expect(Array.isArray(msg.frame.events)).toBe(false);
    }

    const lastState = [...scope.sent].reverse().find((m) => m.type === "state");
    if (!lastState || lastState.type !== "state") throw new Error("expected a state message");

    // Apply ONLY the final received frame (simulating a client that missed every coalesced-away
    // one) to a real Task-3 store, and compare against a snapshot read directly off the world —
    // nothing lost to latest-wins.
    const store = createGameStore();
    store.applyStateFrame(lastState.frame);
    const directFrame = buildStateFrame(getWorld(), null);
    expect(store.getSnapshot().slices).toEqual(directFrame.slices);
    expect(store.getSnapshot().worldVersion).toBe(directFrame.worldVersion);
  }, 15_000);
});

describe("createGameWorker — lifecycle commands", () => {
  it("newGame yields a full frame for the fresh world", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);
    scope.sent.length = 0;

    send(scope, { id: "ng", type: "newGame", payload: SMALL_NEW_GAME });
    const result = await waitForCommandResult(scope, "ng");
    expect(result.result.ok).toBe(true);

    const state = [...scope.sent].reverse().find((m) => m.type === "state");
    if (!state || state.type !== "state") throw new Error("expected a state message");
    expect(state.frame.worldVersion).toBeGreaterThan(0);
    for (const key of ["atlas", "universe", "factions", "systemVitals", "market", "ownership"] as const) {
      expect(state.frame.slices[key]).toBeDefined();
    }
  });

  it("listSaves is valid world-less and returns an empty listing before any save exists", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);

    send(scope, { id: "ls", type: "listSaves", payload: null });
    const result = await waitForCommandResult(scope, "ls");
    expect(result.result).toEqual({ ok: true, data: [] });
  });
});

describe("createGameWorker — commands while paused", () => {
  it("a command while paused returns its result plus a version frame", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);
    send(scope, { id: "ng", type: "newGame", payload: SMALL_NEW_GAME });
    await waitForCommandResult(scope, "ng");
    scope.sent.length = 0;

    const versionBefore = getWorldVersion();
    const tickBefore = getWorld().meta.currentTick;
    const systemId = getWorld().systems[0].id;

    send(scope, { id: "pin", type: "setSystemPin", payload: { systemId, pinned: true } });
    const result = await waitForCommandResult(scope, "pin");
    expect(result.result).toEqual({ ok: true, data: [systemId] });

    const state = [...scope.sent].reverse().find((m) => m.type === "state");
    if (!state || state.type !== "state") throw new Error("expected a state message");
    expect(state.frame.worldVersion).toBeGreaterThan(versionBefore);
    // Still paused: the world-mutating command applied without any tick running.
    expect(getWorld().meta.currentTick).toBe(tickBefore);
  });
});

describe("createGameWorker — saveGame / loadGame", () => {
  it("saveGame with a world round-trips: loadGame restores the same world (tick + content hash)", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);
    send(scope, { id: "ng", type: "newGame", payload: SMALL_NEW_GAME });
    await waitForCommandResult(scope, "ng");

    const tickBefore = getWorld().meta.currentTick;
    const hashBefore = worldHash();

    send(scope, { id: "save", type: "saveGame", payload: { name: "round-trip-save" } });
    const saveResult = await waitForCommandResult(scope, "save");
    expect(saveResult.result.ok).toBe(true);

    // Replace the world with a genuinely different one (different seed) so the load below is a
    // real restore, not a no-op that would pass even if loadGame did nothing.
    send(scope, { id: "ng2", type: "newGame", payload: { ...SMALL_NEW_GAME, seed: 999 } });
    await waitForCommandResult(scope, "ng2");
    expect(worldHash()).not.toBe(hashBefore);

    send(scope, { id: "load", type: "loadGame", payload: { name: "round-trip-save" } });
    const loadResult = await waitForCommandResult(scope, "load");
    expect(loadResult.result.ok).toBe(true);

    expect(getWorld().meta.currentTick).toBe(tickBefore);
    expect(worldHash()).toBe(hashBefore);
  });

  it("loadGame is valid before any newGame — world-less to loaded, one committed full frame", async () => {
    // Fixture: a save produced by a prior "session" (a first worker instance), so the second
    // worker below genuinely never calls newGame before loading it.
    const producer = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(producer);
    producer.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(producer);
    send(producer, { id: "ng", type: "newGame", payload: SMALL_NEW_GAME });
    await waitForCommandResult(producer, "ng");
    const fixtureTick = getWorld().meta.currentTick;
    send(producer, { id: "save", type: "saveGame", payload: { name: "fixture-save" } });
    await waitForCommandResult(producer, "save");

    // Tear down the producer's world — the shared TickLoop/store singletons carry across worker
    // instances within one process, same as a real page reload starting genuinely world-less.
    tickLoop.stop();
    await tickLoop.whenAutosaveSettled();
    clearWorld();

    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);
    scope.sent.length = 0;

    send(scope, { id: "load", type: "loadGame", payload: { name: "fixture-save" } });
    const result = await waitForCommandResult(scope, "load");
    expect(result.result.ok).toBe(true);

    const state = [...scope.sent].reverse().find((m) => m.type === "state");
    if (!state || state.type !== "state") throw new Error("expected a state message");
    expect(state.frame.worldVersion).toBeGreaterThan(0);
    expect(state.frame.slices.universe).toBeDefined();
    expect(state.frame.slices.atlas).toBeDefined();
    expect(getWorld().meta.currentTick).toBe(fixtureTick);
  });

  it("loadGame of a missing save name returns the discriminated error, never throws or silently drops", async () => {
    const scope = createFakeWorkerScope<InboundMessage, OutboundMessage>();
    createGameWorker(scope);
    scope.receive({ type: "boot", config: BOOT_CONFIG });
    await waitForBoot(scope);

    send(scope, { id: "load", type: "loadGame", payload: { name: "does-not-exist" } });
    const result = await waitForCommandResult(scope, "load");
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error("expected an error result");
    expect(result.result.error).toContain("not found");
  });
});
