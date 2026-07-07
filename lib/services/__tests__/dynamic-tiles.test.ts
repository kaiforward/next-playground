import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getDynamicData } from "@/lib/services/dynamic-tiles";
import { EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import type { World, WorldEvent } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 40 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

function baseEvent(overrides: Partial<WorldEvent>): WorldEvent {
  return {
    id: "ev",
    type: "trade_festival",
    phase: "festival",
    systemId: null,
    regionId: null,
    startTick: 0,
    phaseStartTick: 0,
    phaseDuration: 999,
    severity: 1,
    sourceEventId: null,
    metadata: null,
    ...overrides,
  };
}

describe("getDynamicData", () => {
  it("aggregates concurrent events per system and reports the max danger priority", () => {
    const sysX = world.systems[0];
    const sysY = world.systems[1];

    const events: WorldEvent[] = [
      baseEvent({ id: "e1", type: "trade_festival", phase: "festival", systemId: sysX.id }),
      baseEvent({ id: "e2", type: "asteroid_strike", phase: "impact", systemId: sysX.id }),
      // Duplicate type on the same system — must collapse to one eventTypeIds entry.
      baseEvent({ id: "e3", type: "asteroid_strike", phase: "aftermath", systemId: sysX.id }),
    ];
    setWorld({ ...world, events });

    const data = getDynamicData();

    const tileX = data.systems.find((s) => s.id === sysX.id)!;
    expect([...tileX.eventTypeIds].sort()).toEqual(["asteroid_strike", "trade_festival"]);
    expect(tileX.danger).toBe(
      Math.max(
        EVENT_TYPE_DANGER_PRIORITY.trade_festival,
        EVENT_TYPE_DANGER_PRIORITY.asteroid_strike,
      ),
    );
    const tileY = data.systems.find((s) => s.id === sysY.id)!;
    expect(tileY.eventTypeIds).toEqual([]);
    expect(tileY.danger).toBe(0);
  });
});
