import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyOutboundMessage,
  markWorkerDead,
  handlePageHideSave,
  markDevReloadIfWorldLive,
  restoreFromDevReloadMarkerIfPending,
} from "../worker-connection";
import { createGameStore } from "@/lib/store/game-store";
import { configureCommandTransport, sendCommand } from "@/lib/runtime/command-client";
import type { OutboundMessage, GameCommandResultMessage } from "../worker/game-worker";

/** A trivial in-memory `Storage`-shaped fake, matching `client/dev-reload-marker.ts`'s own test
 *  fixture — no real `sessionStorage`/DOM needed for this pure logic. */
function createFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

afterEach(() => {
  configureCommandTransport(null);
});

function pacingFrame(currentTick: number) {
  return { currentTick, speed: 1 as const, achievedTps: 1, events: {} };
}

describe("applyOutboundMessage — pacing", () => {
  it("applies a pacing frame to the store", () => {
    const store = createGameStore();
    applyOutboundMessage(store, { type: "pacing", frame: pacingFrame(3) });
    expect(store.getSnapshot().pacing).toEqual(pacingFrame(3));
  });
});

describe("applyOutboundMessage — state frame liveness driving", () => {
  it("flips liveness to no-world for the worldVersion:0 sentinel", () => {
    const store = createGameStore();
    store.setLiveness("live");
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 0, slices: {} } });
    expect(store.getSnapshot().liveness).toBe("no-world");
  });

  it("flips liveness to live for a normal worldVersion frame", () => {
    const store = createGameStore();
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 1, slices: {} } });
    expect(store.getSnapshot().liveness).toBe("live");
  });

  it("does not clobber a standing tick-failure pause with a later normal state frame", () => {
    const store = createGameStore();
    store.setLiveness("live");
    // A failed tick's own three posted messages: pacing, tickFailed, then state — in that order.
    applyOutboundMessage(store, { type: "tickFailed", msg: { error: "processor threw" } });
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 12, slices: {} } });

    const snapshot = store.getSnapshot();
    expect(snapshot.liveness).toBe("paused");
    expect(snapshot.failureCause).toBe("processor threw");
    // The state frame itself still applies — only the liveness derivation is suppressed.
    expect(snapshot.worldVersion).toBe(12);
  });

  it("does not resurrect a dead worker's liveness off a stray state frame", () => {
    const store = createGameStore();
    store.setLiveness("dead");
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 3, slices: {} } });
    expect(store.getSnapshot().liveness).toBe("dead");
  });

  it("does not resurrect liveness off a stale in-flight frame the store's replacement floor drops", () => {
    // The composed half of the swap-window bug: `GameStore.applyStateFrame` drops a stale
    // in-flight frame from the outgoing world (`replacementFloor`), but liveness must ALSO stay
    // "no-world" for that same dropped frame — not flip back to "live" because the raw message's
    // worldVersion happened to be > 0. Derived from the store's post-apply worldVersion, never the
    // incoming message directly (see this file's own docstring).
    const store = createGameStore();
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 5, slices: {} } });
    store.beginWorldReplacement();

    // Stale — same version as the outgoing world's last applied frame.
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 5, slices: {} } });
    expect(store.getSnapshot().liveness).toBe("no-world");

    // The new world's own frame — past the floor — lands and liveness follows it.
    applyOutboundMessage(store, { type: "state", frame: { worldVersion: 6, slices: {} } });
    expect(store.getSnapshot().liveness).toBe("live");
  });
});

describe("applyOutboundMessage — tickFailed", () => {
  it("records the cause and pauses", () => {
    const store = createGameStore();
    applyOutboundMessage(store, { type: "tickFailed", msg: { error: "negative stock" } });
    expect(store.getSnapshot().liveness).toBe("paused");
    expect(store.getSnapshot().failureCause).toBe("negative stock");
  });
});

// Proves 3 (build plan Task 12): the in-game autosave's own failure channel — distinct from
// `handlePageHideSave`'s command-result path below, this is `TickLoop.subscribeAutosave` relayed
// through the worker's `autosaveResult` message.
describe("applyOutboundMessage — autosaveResult", () => {
  it("surfaces an autosave failure through the store, not only the console", () => {
    const store = createGameStore();
    applyOutboundMessage(store, { type: "autosaveResult", error: "quota exceeded" });
    expect(store.getSnapshot().autosaveFailure).toBe("quota exceeded");
  });

  it("clears a standing autosave failure on a subsequent successful autosave", () => {
    const store = createGameStore();
    store.setAutosaveFailure("previous failure");
    applyOutboundMessage(store, { type: "autosaveResult", error: null });
    expect(store.getSnapshot().autosaveFailure).toBeNull();
  });
});

describe("applyOutboundMessage — commandResult", () => {
  it("delivers the result to the pending sendCommand call", async () => {
    const posted: { id: string }[] = [];
    configureCommandTransport({ postCommand: (envelope) => posted.push(envelope) });
    const store = createGameStore();

    const pending = sendCommand({ id: "cmd-1", type: "setSpeed", payload: { speed: "max" } });
    applyOutboundMessage(store, {
      type: "commandResult",
      id: posted[0].id,
      result: { ok: true, data: { speed: "max" } },
    } as GameCommandResultMessage);

    const result = await pending;
    expect(result.result).toEqual({ ok: true, data: { speed: "max" } });
  });
});

describe("markWorkerDead", () => {
  it("flips liveness to dead and rejects an in-flight command", async () => {
    configureCommandTransport({ postCommand: () => {} });
    const store = createGameStore();
    store.setLiveness("live");

    const pending = sendCommand({ id: "cmd-1", type: "setSpeed", payload: { speed: "max" } });
    markWorkerDead(store);

    expect(store.getSnapshot().liveness).toBe("dead");
    const result = await pending;
    expect(result.result).toEqual({ ok: false, error: "Worker connection lost." });
  });

  it("rejects a command sent after death without ever posting it", async () => {
    const posted: unknown[] = [];
    configureCommandTransport({ postCommand: (envelope) => posted.push(envelope) });
    const store = createGameStore();

    markWorkerDead(store);
    const result = await sendCommand({ id: "cmd-2", type: "setSpeed", payload: { speed: "max" } });

    expect(result.result).toEqual({ ok: false, error: "Worker connection lost." });
    expect(posted).toHaveLength(0);
  });
});

describe("handlePageHideSave", () => {
  it("no-ops when the store has no world", () => {
    const store = createGameStore();
    const send = vi.fn();
    handlePageHideSave(store, send, "autosave");
    expect(send).not.toHaveBeenCalled();
  });

  it("no-ops when the worker is dead", () => {
    const store = createGameStore();
    store.setLiveness("dead");
    const send = vi.fn();
    handlePageHideSave(store, send, "autosave");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a saveGame command and clears any prior autosave failure on success", async () => {
    const store = createGameStore();
    store.setLiveness("live");
    store.setAutosaveFailure("previous failure");
    const send = vi.fn(
      async (): Promise<GameCommandResultMessage> => ({
        type: "commandResult",
        id: "x",
        result: { ok: true, data: { name: "autosave", tick: 10 } },
      }),
    );

    handlePageHideSave(store, send, "autosave");
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "saveGame", payload: { name: "autosave" } }),
    );
    expect(store.getSnapshot().autosaveFailure).toBeNull();
  });

  it("surfaces a failed autosave through the store's autosaveFailure field", async () => {
    const store = createGameStore();
    store.setLiveness("live");
    const send = vi.fn(
      async (): Promise<GameCommandResultMessage> => ({
        type: "commandResult",
        id: "x",
        result: { ok: false, error: "Node save backend unavailable in-browser" },
      }),
    );

    handlePageHideSave(store, send, "autosave");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getSnapshot().autosaveFailure).toBe("Node save backend unavailable in-browser");
  });
});

// Build plan Task 13 correction (Gate D smoke finding): a worker-graph edit under `vite dev`
// triggers a full PAGE reload, not a worker-side HMR dispose — see `client/dev-reload-marker.ts`'s
// header docstring for the diagnosis. These two functions are the page-side mechanism's pure logic.

describe("markDevReloadIfWorldLive", () => {
  it("marks when a world is live (worldVersion > 0)", () => {
    const store = createGameStore();
    store.applyStateFrame({ worldVersion: 5, slices: {} });
    const storage = createFakeStorage();

    markDevReloadIfWorldLive(store, storage);

    expect(storage.getItem("stellar-trader:dev-reload-restore")).not.toBeNull();
  });

  it("does not mark world-less (worldVersion 0 or never applied) — nothing worth restoring", () => {
    const storage = createFakeStorage();
    markDevReloadIfWorldLive(createGameStore(), storage);
    expect(storage.getItem("stellar-trader:dev-reload-restore")).toBeNull();

    const worldLessStore = createGameStore();
    worldLessStore.applyStateFrame({ worldVersion: 0, slices: {} });
    markDevReloadIfWorldLive(worldLessStore, storage);
    expect(storage.getItem("stellar-trader:dev-reload-restore")).toBeNull();
  });
});

describe("restoreFromDevReloadMarkerIfPending", () => {
  it("when the marker is present: begins a world replacement and dispatches loadGame(autosaveName), consuming the marker", async () => {
    const store = createGameStore();
    store.applyStateFrame({ worldVersion: 3, slices: {} }); // a prior "live" world, pre-reload
    const storage = createFakeStorage();
    markDevReloadIfWorldLive(store, storage);
    const send = vi.fn(
      async (): Promise<GameCommandResultMessage> => ({
        type: "commandResult",
        id: "x",
        result: { ok: true, data: { seed: 1, systemCount: 1, mapSize: 1, currentTick: 0 } },
      }),
    );

    restoreFromDevReloadMarkerIfPending(store, storage, send, "autosave");

    // The store-side half of the swap-window contract: replaced BEFORE the async load settles.
    expect(store.getSnapshot().worldVersion).toBe(0);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "loadGame", payload: { name: "autosave" } }),
    );
    // Consumed — a later boot with no HMR reload involved must never find it again.
    expect(storage.getItem("stellar-trader:dev-reload-restore")).toBeNull();
  });

  it("is a no-op when no marker is present — every ordinary boot is untouched", () => {
    const store = createGameStore();
    const storage = createFakeStorage();
    const send = vi.fn();

    restoreFromDevReloadMarkerIfPending(store, storage, send, "autosave");

    expect(send).not.toHaveBeenCalled();
    expect(store.getSnapshot().worldVersion).toBeNull();
  });
});

// Type-only sanity: OutboundMessage's "state" branch is what the tests above construct directly.
const _typeCheck: OutboundMessage = { type: "state", frame: { worldVersion: 0, slices: {} } };
void _typeCheck;
