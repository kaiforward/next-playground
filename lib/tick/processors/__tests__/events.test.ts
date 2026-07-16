import { describe, it, expect } from "vitest";
import { runEventsProcessor } from "../events";
import { InMemoryEventsWorld } from "@/lib/tick/adapters/memory/events";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { mulberry32 } from "@/lib/engine/universe-gen";
import type { EventsProcessorParams } from "@/lib/tick/world/events-world";
import type { TickContext } from "@/lib/tick/types";
import type {
  TickConnection,
  TickEvent,
  TickMarket,
  TickSystem,
} from "@/lib/tick/rows";
import type { ModifierRow } from "@/lib/engine/events";
import type { SystemShock } from "@/lib/tick/world/events-world";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";

function makeCtx(tick: number): TickContext {
  return { tick, results: new Map() };
}

function makeParams(
  overrides: Partial<EventsProcessorParams> = {},
): EventsProcessorParams {
  return {
    rng: mulberry32(1),
    caps: { maxEventsGlobal: 100, maxEventsPerSystem: 3 },
    batchSize: 3,
    spawnInterval: 5,
    definitions: EVENT_DEFINITIONS,
    spawnEnabled: false,
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
    buildingIdleMonths: {},
    yields: unitResourceVector(),
    slotCap: emptyResourceVector(),
    generalSpace: 0,
    habitableSpace: 0,
  };
}

function makeMarket(
  systemId: string,
  goodId: string,
  stock: number,
): TickMarket {
  return {
    systemId,
    goodId,
    basePrice: 100,
    stock,
    anchorMult: 1,
    demandRate: 1,
    priceFloor: 0.2,
    priceCeiling: 5.0,
    storageCapacity: 0,
  };
}

function makeWorld(opts: {
  systems: TickSystem[];
  connections?: TickConnection[];
  events?: TickEvent[];
  markets?: TickMarket[];
  modifiers?: ModifierRow[];
}) {
  return new InMemoryEventsWorld(
    {
      events: opts.events ?? [],
      modifiers: opts.modifiers ?? [],
      markets: opts.markets ?? [],
      nextId: 0,
    },
    opts.systems,
    opts.connections ?? [],
    EVENT_DEFINITIONS,
  );
}

describe("runEventsProcessor", () => {
  it("does nothing when there are no events and spawn is disabled", async () => {
    const world = makeWorld({ systems: [makeSystem("s1", "r1")] });

    const result = await runEventsProcessor(world, makeCtx(1), makeParams());

    expect(world.events).toEqual([]);
    expect(world.modifiers).toEqual([]);
    expect(result.globalEvents?.eventNotifications).toBeUndefined();
  });

  it("spawns events on spawn ticks when spawn is enabled", async () => {
    const systems = Array.from({ length: 10 }, (_, i) =>
      makeSystem(`s${i}`, "r1"),
    );
    const world = makeWorld({ systems });

    await runEventsProcessor(
      world,
      makeCtx(5),
      makeParams({ spawnEnabled: true }),
    );

    expect(world.events.length).toBeGreaterThan(0);
    // Each spawned event should sit in the first phase of its definition.
    for (const e of world.events) {
      const def = EVENT_DEFINITIONS[e.type];
      expect(def.phases[0].name).toBe(e.phase);
      expect(e.startTick).toBe(5);
    }
  });

  it("respects spawnEnabled=false even on spawn ticks", async () => {
    const systems = Array.from({ length: 10 }, (_, i) =>
      makeSystem(`s${i}`, "r1"),
    );
    const world = makeWorld({ systems });

    await runEventsProcessor(
      world,
      makeCtx(5),
      makeParams({ spawnEnabled: false }),
    );

    expect(world.events).toEqual([]);
  });

  it("expires an event whose final phase has elapsed", async () => {
    const ev: TickEvent = {
      id: "ev1",
      type: "trade_festival",
      // trade_festival has phases [setup, festival]; "festival" is the last.
      phase: EVENT_DEFINITIONS.trade_festival.phases.at(-1)!.name,
      systemId: "s1",
      regionId: "r1",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 1,
      severity: 1,
      sourceEventId: null,
    };

    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      events: [ev],
    });

    const result = await runEventsProcessor(world, makeCtx(10), makeParams());

    expect(world.events).toEqual([]);
    expect(result.globalEvents?.eventNotifications?.length).toBeGreaterThan(0);
  });

  it("applies percentage-mode shocks", async () => {
    // Build a synthetic event whose next-phase shock is percentage-mode.
    // We construct it manually rather than waiting for a real spawn so the
    // test stays focused on shock-mode handling.
    const def = EVENT_DEFINITIONS.trade_festival;
    const firstPhase = def.phases[0];

    const ev: TickEvent = {
      id: "ev1",
      type: "trade_festival",
      phase: firstPhase.name,
      systemId: "s1",
      regionId: "r1",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 0, // expire-or-advance immediately on tick 1
      severity: 1,
      sourceEventId: null,
    };

    const market = makeMarket("s1", "food", 100);
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      events: [ev],
      markets: [market],
    });

    await runEventsProcessor(world, makeCtx(1), makeParams());

    // Whether shocks fired depends on the canonical event def's shock list.
    // What we're asserting here is that the processor completes without
    // crashing on percentage-mode shocks. Market values must be within
    // their per-market band.
    for (const m of world.markets) {
      const band = marketBandForRow(m, m);
      expect(m.stock).toBeGreaterThanOrEqual(band.minStock);
      expect(m.stock).toBeLessThanOrEqual(band.maxStock);
    }
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
      severity: 1,
      sourceEventId: null,
    };
    const dissolution: TickEvent = {
      id: "ev-diss",
      type: "alliance_dissolved",
      phase: "dissolving",
      // Relations-owned events have no system/region target; placeholders here
      // satisfy the TickEvent type without exercising any per-system logic.
      systemId: "",
      regionId: "",
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 1,
      severity: 1,
      sourceEventId: null,
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
});

describe("InMemoryEventsWorld.applyShocks", () => {
  function shock(over: Partial<SystemShock>): SystemShock {
    return {
      systemId: "s1",
      goodId: "food",
      parameter: "supply",
      value: 0,
      mode: "percentage",
      ...over,
    };
  }

  it("a percentage supply shock raises stock directly", async () => {
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [makeMarket("s1", "food", 100)],
    });
    const touched = await world.applyShocks([
      shock({ parameter: "supply", mode: "percentage", value: 0.3 }),
    ]);
    expect(touched).toBe(1);
    expect(world.markets[0].stock).toBe(130); // 100 + round(100*0.3)
  });

  it("a percentage demand shock lowers stock inversely (more demand → scarcer)", async () => {
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [makeMarket("s1", "food", 100)],
    });
    const touched = await world.applyShocks([
      shock({ parameter: "demand", mode: "percentage", value: 0.3 }),
    ]);
    expect(touched).toBe(1);
    expect(world.markets[0].stock).toBe(70); // 100 − round(100*0.3)
  });

  it("an absolute demand shock subtracts the raw value", async () => {
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [makeMarket("s1", "food", 100)],
    });
    await world.applyShocks([
      shock({ parameter: "demand", mode: "absolute", value: 50 }),
    ]);
    expect(world.markets[0].stock).toBe(50);
  });

  it("accumulates multiple shocks on one market then clamps once (not per-shock)", async () => {
    // Per-shock clamping would give 80: (100 + 150 → clamp 200) − 120 = 80.
    // Accumulate-then-clamp gives 130: clamp(100 + 150 − 120). The latter is
    // the contract (parity with the Prisma adapter).
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [makeMarket("s1", "food", 100)],
    });
    await world.applyShocks([
      shock({ parameter: "supply", mode: "absolute", value: 150 }),
      shock({ parameter: "demand", mode: "absolute", value: 120 }),
    ]);
    expect(world.markets[0].stock).toBe(130);
  });

  it("clamps the final accumulated value to the stock band", async () => {
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [makeMarket("s1", "food", 100)],
    });
    await world.applyShocks([
      shock({ parameter: "supply", mode: "absolute", value: 10_000 }),
    ]);
    // makeMarket fixture: demandRate=1, priceFloor=0.2, storageCapacity=0
    // → maxStock = TARGET_COVER/priceFloor + 0 = 40/0.2 = 200
    expect(world.markets[0].stock).toBe(200);
  });

  it("skips non-finite shock values and missing markets", async () => {
    const world = makeWorld({
      systems: [makeSystem("s1", "r1")],
      markets: [makeMarket("s1", "food", 100)],
    });
    const touched = await world.applyShocks([
      shock({ value: Infinity }),
      shock({ goodId: "no_such_good", mode: "absolute", value: 10 }),
    ]);
    expect(touched).toBe(0);
    expect(world.markets[0].stock).toBe(100);
  });

  it("skips a shock whose target system is not developed (inert market stays frozen)", async () => {
    // Same 30% supply shock that raises a developed market to 130 above — but on a
    // controlled (non-developed) system the developed-gate skips it, leaving stock frozen.
    const world = makeWorld({
      systems: [makeSystem("s1", "r1", "controlled")],
      markets: [makeMarket("s1", "food", 100)],
    });
    const touched = await world.applyShocks([
      shock({ parameter: "supply", mode: "percentage", value: 0.3 }),
    ]);
    expect(touched).toBe(0);
    expect(world.markets[0].stock).toBe(100);
  });
});
