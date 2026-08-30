import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getActiveEvents } from "@/lib/services/events";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { RELATIONS_PHASE_SENTINEL } from "@/lib/constants/relations";
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
    type: "border_conflict",
    phase: "skirmish",
    systemId: null,
    regionId: null,
    startTick: 0,
    phaseStartTick: 0,
    phaseDuration: 0,
    metadata: null,
    ...overrides,
  };
}

describe("getActiveEvents", () => {
  it("includes system-less (region/pair-level) events — live data produces these for both relations-lifecycle types", () => {
    const [factionA, factionB] = world.factions;
    const events: WorldEvent[] = [
      baseEvent({
        id: "ev-pact",
        type: "pact_under_negotiation",
        phase: "negotiation",
        systemId: null,
        regionId: null,
        phaseDuration: RELATIONS_PHASE_SENTINEL,
        metadata: { factionAId: factionA.id, factionBId: factionB.id, expiresAtTick: 150 },
      }),
      baseEvent({ id: "ev-system", systemId: world.systems[0].id }),
    ];
    setWorld({ ...world, meta: { ...world.meta, currentTick: CURRENT_TICK }, events });

    const active = getActiveEvents();
    expect(active.map((e) => e.id).sort()).toEqual(["ev-pact", "ev-system"]);

    const pact = active.find((e) => e.id === "ev-pact")!;
    expect(pact.systemId).toBeNull();
    expect(pact.systemName).toBeNull();
  });

  it("resolves systemName and display fields, and clamps ticksRemaining to 0 when expired", () => {
    const sysA = world.systems[0];

    const events: WorldEvent[] = [
      // 80 + 50 - 100 = 30 ticks remaining.
      baseEvent({
        id: "ev-active",
        type: "border_conflict",
        phase: "skirmish",
        systemId: sysA.id,
        phaseStartTick: 80,
        phaseDuration: 50,
      }),
    ];
    setWorld({ ...world, meta: { ...world.meta, currentTick: CURRENT_TICK }, events });

    const active = getActiveEvents();
    expect(active).toHaveLength(1);

    const evActive = active.find((e) => e.id === "ev-active")!;
    expect(evActive.systemName).toBe(sysA.name);
    expect(evActive.name).toBe(EVENT_DEFINITIONS.border_conflict.name);
    expect(evActive.phaseDisplayName).toBe(
      EVENT_DEFINITIONS.border_conflict.phases.find((p) => p.name === "skirmish")!.displayName,
    );
    expect(evActive.ticksRemaining).toBe(30);
  });

  it("reads ticksRemaining from metadata.expiresAtTick for a relations-lifecycle event, not its sentinel phaseDuration", () => {
    const [factionA, factionB] = world.factions;
    const events: WorldEvent[] = [
      baseEvent({
        id: "ev-pact",
        type: "pact_under_negotiation",
        phase: "negotiation",
        systemId: null,
        regionId: null,
        phaseStartTick: 10,
        // Sentinel — never a real duration for this type. Reading phaseStartTick + phaseDuration
        // (10 + 2,000,000,000) instead of metadata.expiresAtTick would produce a ticksRemaining
        // nowhere near the real 30.
        phaseDuration: RELATIONS_PHASE_SENTINEL,
        metadata: { factionAId: factionA.id, factionBId: factionB.id, expiresAtTick: 130 },
      }),
    ];
    setWorld({ ...world, meta: { ...world.meta, currentTick: CURRENT_TICK }, events });

    const active = getActiveEvents();
    expect(active).toHaveLength(1);
    expect(active[0].ticksRemaining).toBe(30);
    expect(active[0].name).toBe(EVENT_DEFINITIONS.pact_under_negotiation.name);
    expect(active[0].phaseDisplayName).toBe(
      EVENT_DEFINITIONS.pact_under_negotiation.phases.find((p) => p.name === "negotiation")!.displayName,
    );
  });
});
