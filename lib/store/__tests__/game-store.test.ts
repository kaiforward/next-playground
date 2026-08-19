import { describe, expect, it } from "vitest";
import { createGameStore } from "../game-store";
import type { StateFrame } from "@/lib/runtime/snapshot";
import type { PacingFrame } from "@/lib/runtime/channel";

function edge(totalVolume: number) {
  return {
    fromSystemId: "sys-a",
    toSystemId: "sys-b",
    totalVolume,
    dominantGoodId: "ore",
    perGood: { ore: totalVolume },
  };
}

function pacingFrame(currentTick: number): PacingFrame {
  return { currentTick, speed: 1, achievedTps: 1, events: {} };
}

describe("createGameStore — applyStateFrame", () => {
  it("stores a frame applied to an empty store verbatim (vacuity)", () => {
    const store = createGameStore();
    const visibility = { systemIds: ["sys-a"] };
    const frame: StateFrame = { worldVersion: 1, slices: { visibility } };

    store.applyStateFrame(frame);

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(1);
    expect(snapshot.slices.visibility).toBe(visibility);
  });

  it("keeps an unchanged slice's identity across two applies while a changed slice gets new identity", () => {
    const store = createGameStore();
    store.applyStateFrame({
      worldVersion: 1,
      slices: {
        visibility: { systemIds: ["sys-a"] },
        tradeFlow: { logisticsEdges: [edge(10)] },
      },
    });
    const first = store.getSnapshot();

    store.applyStateFrame({
      worldVersion: 2,
      slices: {
        // Same value, freshly-allocated object — must be recognised as deep-equal.
        visibility: { systemIds: ["sys-a"] },
        tradeFlow: { logisticsEdges: [edge(20)] },
      },
    });
    const second = store.getSnapshot();

    expect(second.slices.visibility).toBe(first.slices.visibility);
    expect(second.slices.tradeFlow).not.toBe(first.slices.tradeFlow);
    expect(second.slices.tradeFlow).toEqual({ logisticsEdges: [edge(20)] });
  });

  it("ignores a frame older than the held version (out-of-order safety)", () => {
    const store = createGameStore();
    store.applyStateFrame({ worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });

    store.applyStateFrame({ worldVersion: 3, slices: { visibility: { systemIds: ["b"] } } });

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(5);
    expect(snapshot.slices.visibility).toEqual({ systemIds: ["a"] });
  });

  it("ignores a frame at the same version as the one already held (no re-notify)", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.applyStateFrame({ worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });
    store.applyStateFrame({ worldVersion: 5, slices: { visibility: { systemIds: ["b"] } } });

    expect(notifications).toBe(1);
    expect(store.getSnapshot().slices.visibility).toEqual({ systemIds: ["a"] });
  });

  it("notifies subscribers exactly once per applied frame, including non-tick version jumps", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    // A tick-driven bump...
    store.applyStateFrame({ worldVersion: 1, slices: { visibility: { systemIds: ["a"] } } });
    // ...and a non-tick writer's bump (a pin/settings write can jump the version by more than 1).
    store.applyStateFrame({ worldVersion: 7, slices: { visibility: { systemIds: ["b"] } } });

    expect(notifications).toBe(2);
  });

  it("does not notify for a dropped (stale) frame", () => {
    const store = createGameStore();
    store.applyStateFrame({ worldVersion: 5, slices: {} });
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.applyStateFrame({ worldVersion: 4, slices: {} });

    expect(notifications).toBe(0);
  });
});

describe("createGameStore — applyPacingFrame", () => {
  it("merges pacing state and notifies on every applied pacing frame", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.applyPacingFrame(pacingFrame(1));
    store.applyPacingFrame(pacingFrame(2));

    expect(notifications).toBe(2);
    expect(store.getSnapshot().pacing).toEqual(pacingFrame(2));
  });

  it("never touches slices or worldVersion", () => {
    const store = createGameStore();
    store.applyStateFrame({ worldVersion: 3, slices: { visibility: { systemIds: ["a"] } } });
    const beforeSlices = store.getSnapshot().slices;

    store.applyPacingFrame(pacingFrame(1));

    const after = store.getSnapshot();
    expect(after.slices).toBe(beforeSlices);
    expect(after.worldVersion).toBe(3);
  });
});

describe("createGameStore — setLiveness", () => {
  it("updates liveness and notifies", () => {
    const store = createGameStore();
    expect(store.getSnapshot().liveness).toBe("no-world");

    let notifications = 0;
    store.subscribe(() => notifications++);
    store.setLiveness("live");

    expect(store.getSnapshot().liveness).toBe("live");
    expect(notifications).toBe(1);
  });
});
