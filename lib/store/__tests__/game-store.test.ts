import { describe, expect, it } from "vitest";
import { createGameStore, selectIsReplacing } from "../game-store";
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
    const frame: StateFrame = { frameSeq: 1, worldVersion: 1, slices: { visibility } };

    store.applyStateFrame(frame);

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(1);
    expect(snapshot.slices.visibility).toBe(visibility);
  });

  it("keeps an unchanged slice's identity across two applies while a changed slice gets new identity", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 1,
      worldVersion: 1,
      slices: {
        visibility: { systemIds: ["sys-a"] },
        tradeFlow: { logisticsEdges: [edge(10)] },
      },
    });
    const first = store.getSnapshot();

    store.applyStateFrame({ frameSeq: 2,
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

  it("applies a frame with an equal worldVersion but a higher frameSeq, and notifies (paused-panel case)", () => {
    // The finding-1 fix: frame contents now vary with the interest set too, so a second frame can
    // legitimately arrive at the SAME worldVersion (e.g. an interest reply built while paused,
    // between world commits) and must still be recognised as a newer observation.
    const store = createGameStore();
    let notifications = 0;
    store.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });
    store.subscribe(() => notifications++);

    store.applyStateFrame({ frameSeq: 2, worldVersion: 5, slices: { visibility: { systemIds: ["b"] } } });

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(5);
    expect(snapshot.frameSeq).toBe(2);
    expect(snapshot.slices.visibility).toEqual({ systemIds: ["b"] });
    expect(notifications).toBe(1);
  });

  it("ignores a frame whose frameSeq is behind the held frameSeq, even if its worldVersion is higher (out-of-order safety)", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 5, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });

    store.applyStateFrame({ frameSeq: 3, worldVersion: 9, slices: { visibility: { systemIds: ["b"] } } });

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(5);
    expect(snapshot.frameSeq).toBe(5);
    expect(snapshot.slices.visibility).toEqual({ systemIds: ["a"] });
  });

  it("ignores a frame at the same frameSeq as the one already held, even with a different worldVersion, and does not notify", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 5, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.applyStateFrame({ frameSeq: 5, worldVersion: 7, slices: { visibility: { systemIds: ["b"] } } });

    expect(notifications).toBe(0);
    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(5);
    expect(snapshot.slices.visibility).toEqual({ systemIds: ["a"] });
  });

  it("notifies subscribers exactly once per applied frame, including non-tick version jumps", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    // A tick-driven bump...
    store.applyStateFrame({ frameSeq: 1, worldVersion: 1, slices: { visibility: { systemIds: ["a"] } } });
    // ...and a non-tick writer's bump (a pin/settings write can jump the version by more than 1).
    store.applyStateFrame({ frameSeq: 2, worldVersion: 7, slices: { visibility: { systemIds: ["b"] } } });

    expect(notifications).toBe(2);
  });

  it("does not notify for a dropped (stale) frame", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 5, worldVersion: 5, slices: {} });
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.applyStateFrame({ frameSeq: 4, worldVersion: 4, slices: {} });

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
    store.applyStateFrame({ frameSeq: 1, worldVersion: 3, slices: { visibility: { systemIds: ["a"] } } });
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

describe("createGameStore — setTickFailed", () => {
  it("flips liveness to paused and records the cause in one commit", () => {
    const store = createGameStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.setTickFailed("processor threw: negative stock");

    const snapshot = store.getSnapshot();
    expect(snapshot.liveness).toBe("paused");
    expect(snapshot.failureCause).toBe("processor threw: negative stock");
    expect(notifications).toBe(1);
  });
});

describe("createGameStore — setAutosaveFailure", () => {
  it("records and clears an autosave failure independently of liveness", () => {
    const store = createGameStore();
    store.setLiveness("live");

    store.setAutosaveFailure("quota exceeded");
    expect(store.getSnapshot().autosaveFailure).toBe("quota exceeded");
    expect(store.getSnapshot().liveness).toBe("live");

    store.setAutosaveFailure(null);
    expect(store.getSnapshot().autosaveFailure).toBeNull();
  });
});

describe("createGameStore — beginWorldReplacement", () => {
  it("resets slices, worldVersion, pacing and failure state to the no-world default in one commit", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });
    store.applyPacingFrame(pacingFrame(5));
    store.setTickFailed("boom");
    store.setAutosaveFailure("quota exceeded");

    let notifications = 0;
    store.subscribe(() => notifications++);
    store.beginWorldReplacement();

    const snapshot = store.getSnapshot();
    expect(snapshot.slices).toEqual({});
    // 0, not null: null means "boot hasn't produced a first frame yet" to `client/main.tsx`'s
    // RouteBody, which would tear the start screen (already mounted; the caller of this reset)
    // down into its generic boot-loading state instead of leaving it mounted with its own pending
    // UI. 0 is the worker's own no-world sentinel and reads identically to every other consumer.
    expect(snapshot.worldVersion).toBe(0);
    expect(snapshot.pacing).toBeNull();
    expect(snapshot.liveness).toBe("no-world");
    expect(snapshot.failureCause).toBeNull();
    expect(snapshot.autosaveFailure).toBeNull();
    expect(notifications).toBe(1);
  });

  it("lets the new world's frame apply once its version exceeds the pre-reset floor", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 1, worldVersion: 50, slices: { visibility: { systemIds: ["a"] } } });

    store.beginWorldReplacement();
    // The world-store's version counter is monotonic across a replacement (Task 5) — the new
    // world's own frame is always newer than anything the outgoing world could have posted, never
    // a low/reset-looking number.
    store.applyStateFrame({ frameSeq: 1, worldVersion: 51, slices: { visibility: { systemIds: ["b"] } } });

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(51);
    expect(snapshot.slices.visibility).toEqual({ systemIds: ["b"] });
  });

  it("drops a stale in-flight frame from the OUTGOING world during the swap window, even with a HIGHER frameSeq than the new world's first frame — worldVersion is what the floor checks (Proves 3)", () => {
    // The scenario a naive `worldVersion: 0` reset alone does not cover: the tick loop keeps
    // broadcasting the outgoing world right up to the moment the swap command commits, so a frame
    // carrying a real, pre-reset `worldVersion` can still be in flight on the postMessage channel
    // when `beginWorldReplacement` fires. It must not transiently re-merge the outgoing world's
    // slices or resurrect its liveness before the new world's own frame lands — and this must hold
    // even though `beginWorldReplacement` resets the held `frameSeq` to `null`, which alone would
    // let ANY frameSeq (including a stale, high one) pass the freshness guard: the outgoing frame
    // here carries frameSeq 50 (the OLD worker's counter, still climbing), well above the frameSeq
    // 1 the new (fresh) worker's own first frame will carry — proving the floor, not frameSeq,
    // guards the swap window.
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });
    store.setLiveness("live");

    store.beginWorldReplacement();
    let notifications = 0;
    store.subscribe(() => notifications++);

    // The stale in-flight frame — same worldVersion as the one already applied before the reset,
    // but a HIGH frameSeq (the old worker's counter never stopped climbing).
    store.applyStateFrame({ frameSeq: 50, worldVersion: 5, slices: { visibility: { systemIds: ["STALE"] } } });

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(0);
    expect(snapshot.frameSeq).toBeNull();
    expect(snapshot.slices).toEqual({});
    expect(snapshot.liveness).toBe("no-world");
    expect(notifications).toBe(0);
  });

  it("applies a fresh worker's restarted frameSeq (seq 1) after a replacement reset, even though it is lower than the outgoing world's last frameSeq (Proves 4)", () => {
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 50, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });
    store.setLiveness("live");

    store.beginWorldReplacement();
    let notifications = 0;
    store.subscribe(() => notifications++);

    // The new world's own frame — worldVersion 6 (past the floor), frameSeq 1 (a fresh worker's
    // restarted counter, LOWER than the outgoing world's last-seen frameSeq of 50).
    store.applyStateFrame({ frameSeq: 1, worldVersion: 6, slices: { visibility: { systemIds: ["new-world"] } } });

    const snapshot = store.getSnapshot();
    expect(snapshot.worldVersion).toBe(6);
    expect(snapshot.frameSeq).toBe(1);
    expect(snapshot.slices.visibility).toEqual({ systemIds: ["new-world"] });
    expect(notifications).toBe(1);
  });

  it("latches a floor even when called before any frame has ever landed (worldVersion null) — the never-booted restore caller", () => {
    // The state `client/worker-connection.ts`'s `restoreFromDevReloadMarkerIfPending` calls this
    // in: right after posting `subscribe`, before the worker's own world-less reply has arrived —
    // `worldVersion` is still `null` (never a real prior version; a full page reload discards the
    // whole JS heap, so there is no "outgoing world" here in the ordinary sense). A bare
    // `current.worldVersion` floor (`null`) would leave `replacementFloor` at `null` too —
    // `selectIsReplacing` reads that as "not replacing" — so the worker's own world-less subscribe
    // reply would sail straight through and the route gate would redirect to `/start` before the
    // real load's frame lands. This is the bug the review finding named.
    const store = createGameStore();
    store.beginWorldReplacement();
    expect(selectIsReplacing(store.getSnapshot())).toBe(true);

    // The worker's own world-less subscribe reply — must NOT end the replacement early.
    store.applyStateFrame({ frameSeq: 1, worldVersion: 0, slices: {} });
    expect(selectIsReplacing(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot().worldVersion).toBe(0);

    // The loaded world's own frame (version >= 1) is what actually clears it.
    store.applyStateFrame({ frameSeq: 1, worldVersion: 1, slices: { visibility: { systemIds: ["a"] } } });
    expect(selectIsReplacing(store.getSnapshot())).toBe(false);
    expect(store.getSnapshot().worldVersion).toBe(1);
  });
});

describe("createGameStore — cancelWorldReplacement", () => {
  it("drops the floor so a stuck replacement (a rejected newGame/loadGame) falls back to the ordinary no-world state", () => {
    const store = createGameStore();
    store.beginWorldReplacement();
    expect(selectIsReplacing(store.getSnapshot())).toBe(true);

    store.cancelWorldReplacement();

    expect(selectIsReplacing(store.getSnapshot())).toBe(false);
    // Already-coherent no-world state from beginWorldReplacement — cancel doesn't need to
    // re-establish it, only drop the floor that was keeping "replacing" true.
    expect(store.getSnapshot().worldVersion).toBe(0);
    expect(store.getSnapshot().liveness).toBe("no-world");
    expect(store.getSnapshot().slices).toEqual({});
  });

  it("a subsequent frame at the same version the floor would have blocked now applies normally", () => {
    // Confirms cancel doesn't just flip a flag cosmetically — applyStateFrame's own floor guard is
    // actually cleared, so a later frame the caller retries with isn't dropped as "stale".
    const store = createGameStore();
    store.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: {} });
    store.beginWorldReplacement(); // floor latched at 5
    store.cancelWorldReplacement();

    store.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: { visibility: { systemIds: ["a"] } } });

    expect(store.getSnapshot().worldVersion).toBe(5);
    expect(store.getSnapshot().slices.visibility).toEqual({ systemIds: ["a"] });
  });
});
