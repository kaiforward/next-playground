import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World, WorldEvent, WorldEventMetadata } from "../types";
import { RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * What the tick hands the relations stage, and what it takes back.
 *
 * The stage reads a view assembled here — system ownership for the border graph, and the
 * relations-owned event rows — and returns rewritten event rows the tick folds back into `World`.
 * Both directions are lossy-looking joins with `??` defaults, and a default that fires when it should
 * not is invisible in any "the world still ticks" assertion.
 */

const NEVER = 1_000_000;
const NOTHING_RESOLVES: TickCadence = { cycle: NEVER, construction: NEVER, logistics: NEVER };
/** The tick before a relations tick, so one `runWorldTick` lands on one. */
const BEFORE_RELATIONS_TICK = RELATIONS_FREQUENCY - 1;

function driversFor(world: World, factionAId: string, factionBId: string): string {
  const row = world.relations.find(
    (r) =>
      (r.factionAId === factionAId && r.factionBId === factionBId) ||
      (r.factionAId === factionBId && r.factionBId === factionAId),
  );
  return row?.history.at(-1)?.drivers ?? "";
}

describe("runWorldTick — system ownership reaches the relations border graph", () => {
  it("charges border friction between two factions whose systems are connected", async () => {
    // Border friction is derived from per-system ownership, so a join that flattened factionId away
    // would leave every pair drifting on baseline/doctrine alone — still a plausible-looking number.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const [factionA, factionB] = base.factions;
    const aSystem = base.systems.find((s) => s.factionId === factionA.id);
    const bSystem = base.systems.find((s) => s.factionId === factionB.id);
    expect(aSystem).toBeDefined();
    expect(bSystem).toBeDefined();
    if (!aSystem || !bSystem) return;

    const linked: World = {
      ...base,
      meta: { ...base.meta, currentTick: BEFORE_RELATIONS_TICK },
      connections: [
        ...base.connections,
        { fromId: aSystem.id, toId: bSystem.id, fuelCost: 1 },
        { fromId: bSystem.id, toId: aSystem.id, fuelCost: 1 },
      ],
    };

    const unlinked: World = { ...base, meta: { ...base.meta, currentTick: BEFORE_RELATIONS_TICK } };

    const withBorder = (await runWorldTick(linked, { cadence: NOTHING_RESOLVES })).world;
    const withoutBorder = (await runWorldTick(unlinked, { cadence: NOTHING_RESOLVES })).world;

    expect(driversFor(withBorder, factionA.id, factionB.id)).toContain("border:");
    // Premise guard: the friction is the link, not something the pair had anyway.
    expect(driversFor(withoutBorder, factionA.id, factionB.id)).not.toContain("border:");
  });
});

describe("runWorldTick — a relations-owned event survives the rebuild field for field", () => {
  it("keeps phase, targets, start tick, severity and parent through the round trip", async () => {
    // Every one of these fields is re-read through a `?? default` on the way back into `World`. Each
    // fixture value below is deliberately NOT that default, so a default that fires is a failure
    // rather than a coincidence.
    const base = generateWorld({ systemCount: 40, seed: 7 });
    const metadata: WorldEventMetadata = {
      factionAId: base.factions[0].id,
      factionBId: base.factions[1].id,
      expiresAtTick: 99_999,
    };
    const seeded: WorldEvent = {
      id: "bc-1",
      type: "border_conflict",
      phase: "skirmish",
      systemId: base.systems[3].id,
      regionId: base.regions[0].id,
      startTick: 1,
      phaseStartTick: 1,
      phaseDuration: 100_000,
      severity: 2,
      sourceEventId: "parent-event-1",
      metadata,
    };

    const result = await runWorldTick(
      { ...base, meta: { ...base.meta, currentTick: BEFORE_RELATIONS_TICK }, events: [seeded] },
      { cadence: NOTHING_RESOLVES },
    );
    expect(result.events.processors).toContain("relations"); // premise: the rebuild actually ran

    const after = result.world.events.find((e) => e.id === "bc-1");
    expect(after).toBeDefined();
    if (!after) return;
    expect(after.phase).toBe("skirmish");
    expect(after.systemId).toBe(seeded.systemId);
    expect(after.regionId).toBe(seeded.regionId);
    expect(after.startTick).toBe(1);
    expect(after.startTick).not.toBe(RELATIONS_FREQUENCY); // not silently restamped to `tick`
    expect(after.severity).toBe(2);
    expect(after.sourceEventId).toBe("parent-event-1");
  });
});
