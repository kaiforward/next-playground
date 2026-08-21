import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNewGameMutation, useLoadGameMutation } from "../use-game-lifecycle";
import { installFakeCommandTransport } from "./command-client-fixture";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import { gameStore } from "@/lib/store/use-game-store";
import { selectIsReplacing } from "@/lib/store/game-store";

afterEach(() => {
  configureCommandTransport(null);
});

// Coordinator-flagged stuck-forever edge (build plan Task 13 correction, part 2): a rejected
// newGame/loadGame command leaves `replacementFloor` latched forever unless something clears it —
// the route gate would then sit on boot-loading indefinitely instead of falling back to `/start`.

describe("useNewGameMutation — cancel on a rejected command", () => {
  it("begins a replacement on mutate, then cancels it (isReplacing false again) when the command rejects", async () => {
    const { posted } = installFakeCommandTransport();
    const { result } = renderHook(() => useNewGameMutation());

    act(() => {
      result.current.mutate({
        systemCount: 50,
        seed: 1,
        name: "Test Seat",
        governmentType: "federation",
        doctrine: "mercantile",
      });
    });

    // The swap-window reset already latched a replacement — same contract as an ordinary success.
    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(true);
    expect(gameStore.getSnapshot().worldVersion).toBe(0);

    await act(async () => {
      deliverCommandResult({
        type: "commandResult",
        id: posted[0].id,
        result: { ok: false, error: "bad seed" },
      });
    });

    // Cancelled: the route gate is free to fall back to its ordinary no-world/`/start` state
    // instead of waiting forever for a frame that will never land.
    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(false);
    expect(gameStore.getSnapshot().worldVersion).toBe(0);
  });
});

describe("useLoadGameMutation — cancel on a rejected command", () => {
  it("begins a replacement on mutate, then cancels it when the load fails (missing/corrupt save)", async () => {
    const { posted } = installFakeCommandTransport();
    const { result } = renderHook(() => useLoadGameMutation());

    act(() => {
      result.current.mutate({ name: "does-not-exist" });
    });

    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(true);

    await act(async () => {
      deliverCommandResult({
        type: "commandResult",
        id: posted[0].id,
        result: { ok: false, error: "Save not found: does-not-exist" },
      });
    });

    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(false);
  });

  it("does NOT cancel the replacement on a successful load — the new world's own frame is what clears it", async () => {
    const { posted } = installFakeCommandTransport();
    const { result } = renderHook(() => useLoadGameMutation());

    act(() => {
      result.current.mutate({ name: "good-save" });
    });
    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(true);

    await act(async () => {
      deliverCommandResult({
        type: "commandResult",
        id: posted[0].id,
        result: { ok: true, data: { seed: 1, systemCount: 1, mapSize: 1, currentTick: 3 } },
      });
    });

    // The command succeeding does not itself clear the floor — only the loaded world's own state
    // frame (a separate channel, not modelled by this hook) does. Still replacing here is correct.
    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(true);

    // Confirm the frame landing is what actually clears it, closing the loop.
    gameStore.applyStateFrame({ frameSeq: 1, worldVersion: 1, slices: {} });
    expect(selectIsReplacing(gameStore.getSnapshot())).toBe(false);
  });
});
