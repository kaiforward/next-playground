import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrderBuild } from "../use-construction-orders";
import { installFakeCommandTransport } from "./command-client-fixture";
import { configureCommandTransport, deliverCommandResult, sendCommand } from "@/lib/runtime/command-client";

afterEach(() => {
  configureCommandTransport(null);
});

// Proves 4 (client-runtime build plan Task 8): a rejected command surfaces its error and is never
// silently queued.

describe("a rejected command surfaces its error, never silently queued", () => {
  it("mutate's onError receives the command's error, and isPending returns to false", async () => {
    const { posted } = installFakeCommandTransport();
    const { result } = renderHook(() => useOrderBuild("sys-1"));

    let capturedError: string | null = null;
    act(() => {
      result.current.mutate(
        { buildingType: "farm", levels: 1 },
        { onError: (error) => { capturedError = error; } },
      );
    });
    expect(result.current.isPending).toBe(true);
    expect(posted).toHaveLength(1);

    await act(async () => {
      deliverCommandResult({
        type: "commandResult",
        id: posted[0].id,
        result: { ok: false, error: "No free resource slots for that building here." },
      });
    });

    expect(capturedError).toBe("No free resource slots for that building here.");
    expect(result.current.isPending).toBe(false);
  });

  it("mutateAsync rejects rather than resolving with a swallowed failure", async () => {
    const { posted } = installFakeCommandTransport();
    const { result } = renderHook(() => useOrderBuild("sys-1"));

    // Attach the rejection assertion BEFORE the reject actually fires (inside the same `act` as the
    // delivery) — awaiting it only after `deliverCommandResult` would leave the promise briefly
    // unobserved between the two, and the resulting `isPending` update outside `act`.
    await act(async () => {
      const assertion = expect(result.current.mutateAsync({ buildingType: "farm", levels: 1 })).rejects.toThrow("boom");
      deliverCommandResult({ type: "commandResult", id: posted[0].id, result: { ok: false, error: "boom" } });
      await assertion;
    });
  });

  it("a command posted with no transport configured resolves rejected rather than hanging — never silently queued", async () => {
    configureCommandTransport(null);
    const message = await sendCommand({ id: "unconfigured-1", type: "setSpeed", payload: { speed: "paused" } });
    expect(message.result).toEqual({ ok: false, error: "Command transport not configured." });
  });
});
