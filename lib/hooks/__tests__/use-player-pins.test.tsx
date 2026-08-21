import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSetSystemPin } from "../use-player-pins";
import { useTracker } from "../use-tracker";
import { seedSlices } from "./store-fixture";
import { installFakeCommandTransport } from "./command-client-fixture";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import { DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";
import type { TrackerData } from "@/lib/types/api";

function emptyTracker(): TrackerData {
  return {
    pinnedSystemIds: [],
    pinned: [],
    building: [],
    waitingCount: 0,
    colonising: [],
    sections: DEFAULT_TRACKER_SECTIONS,
  };
}

afterEach(() => {
  configureCommandTransport(null);
});

// Proves 3 (client-runtime build plan Task 8): a pin while paused updates the tracker immediately.
// "While paused" means no tick is going to arrive and refresh the store — the ONLY way the pin
// becomes visible is the command's own result, which the worker returns synchronously-ish whether
// or not the loop is running (`TickLoop.enqueueCommand` "drained ... immediately when paused",
// Task 2's own interface line). This test proves the UI side of that: `useTracker` reflects the pin
// the moment the command resolves, with no state frame in between.

describe("useSetSystemPin — a pin while paused updates the tracker immediately", () => {
  it("reflects the pin on useTracker's return as soon as the command resolves, no state frame needed", async () => {
    const { posted } = installFakeCommandTransport();
    seedSlices({ tracker: emptyTracker() });

    const { result } = renderHook(() => ({ tracker: useTracker(), setPin: useSetSystemPin() }));
    expect(result.current.tracker.pinnedSystemIds).toEqual([]);

    act(() => {
      result.current.setPin.mutate({ systemId: "sys-1", pinned: true });
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].payload).toEqual({ systemId: "sys-1", pinned: true });

    await act(async () => {
      deliverCommandResult({ type: "commandResult", id: posted[0].id, result: { ok: true, data: ["sys-1"] } });
    });

    expect(result.current.tracker.pinnedSystemIds).toEqual(["sys-1"]);
  });
});
