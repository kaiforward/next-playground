import { describe, it, expect } from "vitest";
import { generateRumors } from "../rumors";
import type { ActiveEvent } from "@/lib/types/game";

function makeEvent(overrides: Partial<ActiveEvent>): ActiveEvent {
  return {
    id: "ev1",
    type: "war",
    name: "War",
    phase: "active",
    phaseDisplayName: "Active",
    systemId: "sys1",
    systemName: "Alpha Prime",
    regionId: "reg1",
    startTick: 1,
    phaseStartTick: 1,
    phaseDuration: 10,
    ticksRemaining: 5,
    severity: 0.5,
    ...overrides,
  };
}

describe("generateRumors", () => {
  it("returns a fallback line when no events are active", () => {
    const rumors = generateRumors([]);
    expect(rumors).toHaveLength(1);
    expect(rumors[0].eventId).toBe("");
  });

  it("generates rumors from active events", () => {
    const events = [makeEvent({ type: "war", systemName: "Alpha Prime" })];
    const rumors = generateRumors(events);

    expect(rumors).toHaveLength(1);
    expect(rumors[0].eventType).toBe("war");
    expect(rumors[0].text).toContain("Alpha Prime");
  });

  it("caps at 3 rumors", () => {
    const events = [
      makeEvent({ id: "1", severity: 0.8 }),
      makeEvent({ id: "2", severity: 0.6 }),
      makeEvent({ id: "3", severity: 0.4 }),
      makeEvent({ id: "4", severity: 0.2 }),
    ];

    const rumors = generateRumors(events);
    expect(rumors).toHaveLength(3);
  });

  it("prefers higher severity events", () => {
    const events = [
      makeEvent({ id: "low", severity: 0.1 }),
      makeEvent({ id: "high", severity: 0.9 }),
    ];

    const rumors = generateRumors(events);
    expect(rumors[0].eventId).toBe("high");
  });

  it("handles events with null systemName", () => {
    const events = [makeEvent({ systemName: null })];
    const rumors = generateRumors(events);

    expect(rumors).toHaveLength(1);
    expect(rumors[0].text).toContain("unknown system");
  });
});
