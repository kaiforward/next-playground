import { describe, it, expect } from "vitest";
import { runEventsProcessor } from "../events";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { mulberry32 } from "@/lib/engine/universe-gen";
import type { EventsProcessorParams } from "@/lib/tick/world/events-world";
import type { TickContext } from "@/lib/tick/types";
import type { TickEvent, TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import type { ModifierRow } from "@/lib/engine/events";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";

function makeCtx(tick: number): TickContext {
  return { tick, results: new Map() };
}

function makeParams(
  overrides: Partial<EventsProcessorParams> = {},
): EventsProcessorParams {
  return {
    rng: mulberry32(1),
    definitions: EVENT_DEFINITIONS,
    ...overrides,
  };
}

function makeSystem(
  id: string,
  regionId: string,
  control: TickSystem["control"] = "developed",
): TickSystem {
  return {
    id,
    name: id.toUpperCase(),
    economyType: "extraction",
    regionId,
    factionId: "faction-0",
    control,
    governmentType: "frontier",
    population: 0,
    popCap: 1000,
    unrest: 0,
    buildings: {},
    buildingIdleCycles: {},
    collapseDebt: 0,
    yields: unitResourceVector(),
    extractionEff: unitResourceVector(),
    depositCounts: emptyResourceVector(),
    peopleLand: 0,
  };
}

// Band for this fixture, from the good's own catalog constants (GOODS.food:
// priceFloor 0.5, priceCeiling 2.0) — demandRate 1 ⇒ targetStock = TARGET_COVER
// (40), minStock = 40/2 = 20, maxStock = 40/0.5 + 120 = 200.
function makeMarket(
  systemId: string,
  goodId: string,
  stock: number,
): WorldMarket {
  return {
    systemId,
    goodId,
    stock,
    anchorMult: 1,
    demandRate: 1,
    storageCapacity: 120,
  };
}

function makeWorld(opts: {
  systems: TickSystem[];
  events?: TickEvent[];
  markets?: WorldMarket[];
  modifiers?: ModifierRow[];
}) {
  return new InMemoryEventsWorld(
    {
      events: opts.events ?? [],
      modifiers: opts.modifiers ?? [],
      markets: opts.markets ?? [],
    },
    opts.systems,
    EVENT_DEFINITIONS,
  );
}

describe("runEventsProcessor", () => {
  it("does nothing when there are no events", async () => {
    const world = makeWorld({ systems: [makeSystem("s1", "r1")] });

    const result = await runEventsProcessor(world, makeCtx(1), makeParams());

    expect(world.events).toEqual([]);
    expect(world.modifiers).toEqual([]);
    expect(result.globalEvents).toBeUndefined();
  });

  it("creates zero new events across many former spawn intervals, while a pre-existing multi-phase event advances and expires on schedule", async () => {
    // border_conflict: tension [15,25] → skirmish [25,35] → de_escalation [10,20].
    // The former spawn interval was 5 ticks (EVENT_SPAWN_INTERVAL) — run well past
    // several multiples of it (50) so a surviving spawn path would have fired many
    // times over.
    const rng = mulberry32(42);
    const event: TickEvent = {
      id: "bc-1",
      type: "border_conflict",
      phase: "tension",
      systemId: "s1",
      regionId: "r1",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 20,
    };
    const world = makeWorld({ systems: [makeSystem("s1", "r1")], events: [event] });

    const phasesSeen = new Set<string>();
    let expiredAtTick: number | null = null;
    for (let tick = 1; tick <= 250; tick++) {
      await runEventsProcessor(world, makeCtx(tick), makeParams({ rng }));
      // Never more than the one seeded event — no random spawn ever adds a second.
      expect(world.events.length).toBeLessThanOrEqual(1);
      const survivor = world.events.find((e) => e.id === "bc-1");
      if (survivor) {
        phasesSeen.add(survivor.phase);
      } else if (expiredAtTick === null) {
        expiredAtTick = tick;
      }
    }

    // It advanced through its real phases and expired — the phase machinery still runs.
    expect(phasesSeen).toEqual(new Set(["tension", "skirmish", "de_escalation"]));
    expect(expiredAtTick).not.toBeNull();
    expect(world.events).toEqual([]); // no strays left behind, spawned or otherwise
  });

  it("moves no market stock when an event advances phase", async () => {
    // Shock machinery (ShockTemplate, EventPhaseDefinition.shocks) is gone entirely, with the
    // definitions that once carried it — a phase advance must never touch market stock, only
    // return modifier rows for another processor to apply.
    const ev: TickEvent = {
      id: "ev-1",
      type: "border_conflict",
      phase: "tension",
      systemId: "s1",
      regionId: "r1",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 0, // elapsed immediately at tick 1 → advances into "skirmish"
    };
    const fuelMarket = makeMarket("s1", "fuel", 100);
    const machineryMarket = makeMarket("s1", "machinery", 100);
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      events: [ev],
      markets: [fuelMarket, machineryMarket],
    });

    await runEventsProcessor(world, makeCtx(1), makeParams());

    const survivor = world.events.find((e) => e.id === "ev-1");
    expect(survivor?.phase).toBe("skirmish"); // the phase transition itself still happened
    expect(world.markets.find((m) => m.goodId === "fuel")?.stock).toBe(100);
    expect(world.markets.find((m) => m.goodId === "machinery")?.stock).toBe(100);
  });

  it("skips lifecycle for relations-owned event types (pact_under_negotiation, alliance_dissolved)", async () => {
    // A pact event with phaseDuration=1 would normally advance/expire on the
    // next tick. The events processor must leave it alone — the relations
    // processor owns expiry via metadata.expiresAtTick.
    const pact: TickEvent = {
      id: "ev-pact",
      type: "pact_under_negotiation",
      phase: "negotiation",
      // Relations-owned events have no system/region target; placeholders here
      // satisfy the TickEvent type without exercising any per-system logic.
      systemId: "",
      regionId: "",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 1,
    };
    const dissolution: TickEvent = {
      id: "ev-diss",
      type: "alliance_dissolved",
      phase: "dissolving",
      systemId: "",
      regionId: "",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 1,
    };

    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      events: [pact, dissolution],
    });

    await runEventsProcessor(world, makeCtx(10), makeParams());

    expect(world.events).toHaveLength(2);
    const pactAfter = world.events.find((e) => e.id === "ev-pact");
    const dissolutionAfter = world.events.find((e) => e.id === "ev-diss");
    expect(pactAfter?.phase).toBe("negotiation");
    expect(pactAfter?.phaseStartTick).toBe(0);
    expect(dissolutionAfter?.phase).toBe("dissolving");
    expect(dissolutionAfter?.phaseStartTick).toBe(0);
  });

  it("never carries an event-notifications entry, even across a phase advance and an expiry", async () => {
    // The notification channel is gone entirely (GlobalEventMap.eventNotifications,
    // EventPhaseDefinition.notification) — a phase advance and an expiry must never
    // produce one, only whatever TickProcessorResult defines today.
    const advancing: TickEvent = {
      id: "ev-adv",
      type: "border_conflict",
      phase: "tension",
      systemId: "s1",
      regionId: "r1",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 0, // advances into "skirmish" at tick 1
    };
    const expiring: TickEvent = {
      id: "ev-exp",
      type: "border_conflict",
      phase: "de_escalation",
      systemId: "s2",
      regionId: "r1",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 0, // its final phase — expires at tick 1
    };
    const world = makeWorld({
      systems: [makeSystem("s1", "r1"), makeSystem("s2", "r1")],
      events: [advancing, expiring],
    });

    const result = await runEventsProcessor(world, makeCtx(1), makeParams());

    expect(result.globalEvents).toBeUndefined();
  });
});

describe("InMemoryEventsWorld construction", () => {
  it("de-aliases markets on construction — a later mutation never reaches the caller's array", () => {
    const original = makeMarket("s1", "food", 100);
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [original],
    });

    world.markets[0].stock = 999;

    expect(original.stock).toBe(100); // the caller's row is untouched — a real copy was made
  });
});
