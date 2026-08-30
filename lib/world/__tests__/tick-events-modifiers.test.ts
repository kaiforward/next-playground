import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World, WorldEvent, WorldEventMetadata } from "../types";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { buildModifiersForPhase } from "@/lib/engine/events";
import { RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * How a tick treats the event rows it did not spawn: which phase `world.modifiers` is rebuilt from,
 * whether an event's relations metadata survives the stage that has no field for it, and which events
 * the relations stage is allowed to own.
 *
 * All of it runs on a cadence where nothing but ship-arrivals and events resolves, so the event
 * bookkeeping is not competing with a galaxy-wide economy resolution for the assertion.
 */

const NEVER = 1_000_000;
const NOTHING_RESOLVES: TickCadence = { cycle: NEVER, construction: NEVER, logistics: NEVER };
/** Long enough that no seeded event advances or expires inside a test's single tick. */
const NEVER_ADVANCES = 100_000;

function seededEvent(overrides: Partial<WorldEvent> & Pick<WorldEvent, "id" | "type">): WorldEvent {
  return {
    phase: "",
    systemId: null,
    regionId: null,
    startTick: 0,
    phaseStartTick: 0,
    phaseDuration: NEVER_ADVANCES,
    severity: 1,
    sourceEventId: null,
    metadata: null,
    ...overrides,
  };
}

function worldWith(base: World, events: WorldEvent[], currentTick: number): World {
  return { ...base, meta: { ...base.meta, currentTick }, events };
}

describe("runWorldTick — modifiers rebuilt from each event's CURRENT phase", () => {
  const base = generateWorld({ systemCount: 40, seed: 7 });
  const systemId = base.systems.find((s) => s.control === "developed")?.id ?? base.systems[0].id;
  const definition = EVENT_DEFINITIONS.border_conflict;
  const skirmish = definition.phases.find((p) => p.name === "skirmish");
  const tension = definition.phases.find((p) => p.name === "tension");

  it("emits exactly the phase the event is in, and nothing from any other phase", async () => {
    // The premise this test rests on: the two phases must be distinguishable, or picking the wrong
    // one is invisible.
    expect(skirmish).toBeDefined();
    expect(tension).toBeDefined();
    if (!skirmish || !tension) return;
    const skirmishRows = buildModifiersForPhase(skirmish, systemId, null, 1);
    const tensionRows = buildModifiersForPhase(tension, systemId, null, 1);
    expect(skirmishRows).not.toEqual(tensionRows);
    expect(skirmishRows.length).toBeGreaterThan(0);

    const seeded = worldWith(
      base,
      [seededEvent({ id: "e-1", type: "border_conflict", phase: "skirmish", systemId })],
      0,
    );
    const after = (await runWorldTick(seeded, { cadence: NOTHING_RESOLVES })).world;

    expect(after.events.map((e) => e.phase)).toEqual(["skirmish"]); // premise: it did not advance
    expect(after.modifiers).toEqual(skirmishRows.map((row) => ({ eventId: "e-1", ...row })));
  });
});

describe("runWorldTick — event metadata across the events stage", () => {
  const base = generateWorld({ systemCount: 40, seed: 7 });
  const metadata: WorldEventMetadata = {
    factionAId: base.factions[0].id,
    factionBId: base.factions[1].id,
    expiresAtTick: 99_999,
  };

  it("re-attaches relations metadata the tick event row has no field for", async () => {
    // `TickEvent` deliberately drops `metadata`; the tick carries it out-of-band and puts it back.
    // Lose it and a live border conflict forgets which two factions it is between.
    const seeded = worldWith(
      base,
      [seededEvent({ id: "bc-1", type: "border_conflict", phase: "tension", metadata })],
      0,
    );
    const after = (await runWorldTick(seeded, { cadence: NOTHING_RESOLVES })).world;
    expect(after.events.find((e) => e.id === "bc-1")?.metadata).toEqual(metadata);
  });

  it("leaves an event that never carried metadata at null", async () => {
    // Executes at tick 1 (meta.currentTick + 1) — not a relations tick (RELATIONS_FREQUENCY = 3),
    // so the relations rebuild never runs and cannot touch this event's metadata either way.
    const seeded = worldWith(
      base,
      [seededEvent({ id: "bc-3", type: "border_conflict", phase: "tension", systemId: base.systems[0].id })],
      0,
    );
    const after = (await runWorldTick(seeded, { cadence: NOTHING_RESOLVES })).world;
    expect(after.events.find((e) => e.id === "bc-3")?.metadata).toBeNull();
  });
});

describe("runWorldTick — which events the relations stage owns", () => {
  const base = generateWorld({ systemCount: 40, seed: 7 });
  const metadata: WorldEventMetadata = {
    factionAId: base.factions[0].id,
    factionBId: base.factions[1].id,
    expiresAtTick: 99_999,
  };
  /** The tick before a relations tick, so `runWorldTick` lands on one. */
  const beforeRelationsTick = RELATIONS_FREQUENCY - 1;

  it("hands a metadata-carrying relations event to relations, which hands it back intact", async () => {
    const seeded = worldWith(
      base,
      [seededEvent({ id: "bc-1", type: "border_conflict", phase: "tension", metadata })],
      beforeRelationsTick,
    );
    const result = await runWorldTick(seeded, { cadence: NOTHING_RESOLVES });
    expect(result.events.processors).toContain("relations"); // premise: the stage actually ran
    const survivor = result.world.events.find((e) => e.id === "bc-1");
    expect(survivor).toBeDefined();
    expect(survivor?.type).toBe("border_conflict");
    expect(survivor?.metadata).toEqual(metadata);
  });

  it("drops a relations-typed event with no metadata — relations cannot own it, and nothing else may", async () => {
    // The rebuild replaces every relations-typed row with what the relations stage hands back. A row
    // the stage was never given therefore has no owner, and vanishes; asserting it survives instead
    // would be asserting the guard does not exist.
    const seeded = worldWith(
      base,
      [seededEvent({ id: "bc-2", type: "border_conflict", phase: "tension", metadata: null })],
      beforeRelationsTick,
    );
    const after = (await runWorldTick(seeded, { cadence: NOTHING_RESOLVES })).world;
    expect(after.events.some((e) => e.id === "bc-2")).toBe(false);
  });

  // "leaves a non-relations event alone even when it carries metadata" deleted: it isolated
  // ownership-by-TYPE from ownership-by-metadata using a non-relations-owned type
  // (inner_system_conflict). Post-strip, `RELATIONS_EVENT_TYPES` covers every surviving
  // `EventTypeId` (spec B1/B2), so a "non-relations event" cannot be constructed from a real
  // type without an `as` cast — the branch the test isolated is unreachable by any live data
  // shape, not merely untested.
});
