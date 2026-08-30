import { describe, it, expect } from "vitest";
import { computeEventImpacts } from "../event-analysis";
import type { EventLifecycle } from "../types";

// ── computeEventImpacts: system name resolution ──────────────────
// The runner's own in-run fixture (runner-instrumentation.test.ts, "names the systems events
// happened on") can no longer pin this on a live run: the only events left are the relations
// trio, spawned by faction-pair scores crossing thresholds typically hundreds of ticks in, so a
// short CONFIG run never produces one. The fold itself — systemId resolved through the name map,
// never left as a raw id — is pinned here instead, where the input can be constructed directly.

function makeLifecycle(overrides: Partial<EventLifecycle> = {}): EventLifecycle {
  return {
    id: "evt-1",
    type: "border_conflict",
    systemId: "sys-a",
    severity: 1,
    startTick: 100,
    endTick: 120,
    sourceEventId: null,
    startPrices: [],
    endPrices: [],
    ...overrides,
  };
}

describe("computeEventImpacts", () => {
  it("names the system an event happened on, rather than falling back to its id", () => {
    const nameById = new Map([["sys-a", "Kestrel's Reach"]]);
    const [impact] = computeEventImpacts([makeLifecycle()], nameById);

    expect(impact.systemId).toBe("sys-a");
    expect(impact.systemName).toBe("Kestrel's Reach");
    expect(impact.systemName).not.toBe(impact.systemId);
  });

  it("falls back to the raw id only when the name map has no entry for it", () => {
    const [impact] = computeEventImpacts([makeLifecycle()], new Map());
    expect(impact.systemName).toBe("sys-a");
  });

  it("reports the placeholder for a system-less (region/pair-level) event", () => {
    const [impact] = computeEventImpacts(
      [makeLifecycle({ systemId: null, startPrices: [], endPrices: [] })],
      new Map(),
    );
    expect(impact.systemId).toBeNull();
    expect(impact.systemName).toBe("—");
  });
});
