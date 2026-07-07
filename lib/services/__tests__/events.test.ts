import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getActiveEvents } from "@/lib/services/events";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import type { World, WorldEvent } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 30 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

const CURRENT_TICK = 100;

function baseEvent(overrides: Partial<WorldEvent>): WorldEvent {
  return {
    id: "ev",
    type: "mining_boom",
    phase: "peak",
    systemId: null,
    regionId: null,
    startTick: 0,
    phaseStartTick: 0,
    phaseDuration: 0,
    severity: 1,
    sourceEventId: null,
    metadata: null,
    ...overrides,
  };
}

describe("getActiveEvents", () => {
  it("excludes region-level events (systemId null)", () => {
    const events: WorldEvent[] = [
      baseEvent({ id: "ev-region", systemId: null, regionId: world.regions[0].id }),
      baseEvent({ id: "ev-system", systemId: world.systems[0].id }),
    ];
    setWorld({ ...world, meta: { ...world.meta, currentTick: CURRENT_TICK }, events });

    const active = getActiveEvents();
    expect(active.map((e) => e.id)).toEqual(["ev-system"]);
  });

  it("resolves systemName and display fields, and clamps ticksRemaining to 0 when expired", () => {
    const sysA = world.systems[0];
    const sysB = world.systems[1];

    const events: WorldEvent[] = [
      // 80 + 50 - 100 = 30 ticks remaining.
      baseEvent({
        id: "ev-active",
        type: "mining_boom",
        phase: "peak",
        systemId: sysA.id,
        phaseStartTick: 80,
        phaseDuration: 50,
      }),
      // 10 + 20 - 100 = -70, clamped to 0.
      baseEvent({
        id: "ev-expired",
        type: "solar_storm",
        phase: "storm",
        systemId: sysB.id,
        phaseStartTick: 10,
        phaseDuration: 20,
      }),
    ];
    setWorld({ ...world, meta: { ...world.meta, currentTick: CURRENT_TICK }, events });

    const active = getActiveEvents();
    expect(active).toHaveLength(2);

    const evActive = active.find((e) => e.id === "ev-active")!;
    expect(evActive.systemName).toBe(sysA.name);
    expect(evActive.name).toBe(EVENT_DEFINITIONS.mining_boom.name);
    expect(evActive.phaseDisplayName).toBe(
      EVENT_DEFINITIONS.mining_boom.phases.find((p) => p.name === "peak")!.displayName,
    );
    expect(evActive.ticksRemaining).toBe(30);

    const evExpired = active.find((e) => e.id === "ev-expired")!;
    expect(evExpired.systemName).toBe(sysB.name);
    expect(evExpired.name).toBe(EVENT_DEFINITIONS.solar_storm.name);
    expect(evExpired.phaseDisplayName).toBe(
      EVENT_DEFINITIONS.solar_storm.phases.find((p) => p.name === "storm")!.displayName,
    );
    expect(evExpired.ticksRemaining).toBe(0);
  });
});
