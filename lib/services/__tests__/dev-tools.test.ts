import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld, getWorldVersion } from "@/lib/world/store";
import { tickLoop } from "@/lib/world/tick-loop";
import {
  advanceTicks,
  spawnEvent,
  resetEconomy,
  getEconomySnapshot,
  inspectWorld,
} from "@/lib/services/dev-tools";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { getInitialStock } from "@/lib/constants/market-economy";
import { yieldsOf } from "@/lib/engine/resources";
import type { World, WorldEvent, WorldEventModifier } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 50, seed: 42 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("spawnEvent", () => {
  it("creates an event and its phase modifiers on the happy path", () => {
    const system = world.systems[0];
    const def = EVENT_DEFINITIONS.solar_storm;
    const firstPhase = def.phases[0];
    expect(firstPhase.modifiers.length).toBeGreaterThan(0);

    const result = spawnEvent({ systemId: system.id, eventType: "solar_storm" });
    if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

    expect(result.data.type).toBe("solar_storm");
    expect(result.data.phase).toBe(firstPhase.name);
    expect(result.data.eventId).toMatch(/^event-/);

    const after = getWorld();
    const event = after.events.find((e) => e.id === result.data.eventId);
    expect(event).toBeDefined();
    expect(event?.systemId).toBe(system.id);
    expect(event?.regionId).toBe(system.regionId);
    expect(event?.type).toBe("solar_storm");
    expect(event?.phase).toBe(firstPhase.name);

    const modifiers = after.modifiers.filter((m) => m.eventId === result.data.eventId);
    expect(modifiers.length).toBe(firstPhase.modifiers.length);

    // nextId advances so subsequent spawns mint a fresh id.
    expect(after.nextId).toBe(world.nextId + 1);
  });

  it("creates an event with zero modifiers when the first phase defines none", () => {
    const system = world.systems[0];
    const def = EVENT_DEFINITIONS.border_conflict;
    const firstPhase = def.phases[0];
    expect(firstPhase.modifiers.length).toBe(0);

    const result = spawnEvent({ systemId: system.id, eventType: "border_conflict" });
    if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

    const after = getWorld();
    const modifiers = after.modifiers.filter((m) => m.eventId === result.data.eventId);
    expect(modifiers.length).toBe(0);
    expect(after.events.some((e) => e.id === result.data.eventId)).toBe(true);
  });

  it("returns ok:false for an unknown event type", () => {
    const system = world.systems[0];
    const result = spawnEvent({ systemId: system.id, eventType: "not_a_real_event" });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for an unknown system id", () => {
    const result = spawnEvent({ systemId: "does-not-exist", eventType: "solar_storm" });
    expect(result.ok).toBe(false);
  });
});

describe("resetEconomy", () => {
  it("reseeds market stock to getInitialStock and resets anchorMult, clearing events/modifiers", () => {
    // A settled system — only those have market rows to reseed.
    const system = world.systems.find((s) => s.control === "developed")!;

    // Mutate one market row for this system away from its seeded values.
    const targetGoodId = world.markets.find((m) => m.systemId === system.id)!.goodId;
    const mutatedMarkets = world.markets.map((m) =>
      m.systemId === system.id && m.goodId === targetGoodId
        ? { ...m, stock: 999_999, anchorMult: 2.5 }
        : m,
    );

    // Seed a fake event + modifier so we can assert they're cleared.
    const fakeEvent: WorldEvent = {
      id: "fake-event-1",
      type: "solar_storm",
      phase: "storm",
      systemId: system.id,
      regionId: system.regionId,
      startTick: 0,
      phaseStartTick: 0,
      phaseDuration: 20,
      severity: 1,
      sourceEventId: null,
      metadata: null,
    };
    const fakeModifier: WorldEventModifier = {
      eventId: "fake-event-1",
      domain: "economy",
      type: "rate_multiplier",
      targetType: "system",
      targetId: system.id,
      goodId: null,
      parameter: "production_rate",
      value: 0.05,
    };

    const seeded: World = {
      ...world,
      markets: mutatedMarkets,
      events: [fakeEvent],
      modifiers: [fakeModifier],
    };
    setWorld(seeded);

    const result = resetEconomy();
    if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

    expect(result.data.marketsReset).toBe(seeded.markets.length);
    expect(result.data.eventsCleared).toBe(1);

    const after = getWorld();
    expect(after.events).toEqual([]);
    expect(after.modifiers).toEqual([]);

    // Independently compute the expected seed stock the same way the source does.
    const buildings: Record<string, number> = {};
    for (const b of world.buildings) {
      if (b.systemId === system.id) buildings[b.buildingType] = b.count;
    }
    const yields = yieldsOf(system);
    const expectedStock = getInitialStock(buildings, yields, system.population, targetGoodId);

    const resetRow = after.markets.find((m) => m.systemId === system.id && m.goodId === targetGoodId);
    expect(resetRow).toBeDefined();
    expect(resetRow?.stock).toBe(expectedStock);
    expect(resetRow?.anchorMult).toBe(1);
  });
});

describe("advanceTicks", () => {
  it("advances world.meta.currentTick by the requested count", async () => {
    const result = await advanceTicks(2);
    if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

    expect(result.data.newTick).toBe(world.meta.currentTick + 2);
    expect(getWorld().meta.currentTick).toBe(world.meta.currentTick + 2);
    expect(result.data.elapsed).toBeGreaterThanOrEqual(0);
  });

  it("returns ok:false for a count outside [1, 1000]", async () => {
    const tooLow = await advanceTicks(0);
    expect(tooLow.ok).toBe(false);
    const tooHigh = await advanceTicks(1001);
    expect(tooHigh.ok).toBe(false);
  });

  describe("Task 13 Proves 1 — publishes through the loop's own notify path", () => {
    it("commits once PER TICK (not once for the whole batch) and notifies a tickLoop subscriber before the batch resolves", async () => {
      const seen: number[] = [];
      const unsubscribe = tickLoop.subscribe((broadcast) => seen.push(broadcast.currentTick));
      const startVersion = getWorldVersion();

      const result = await advanceTicks(3);
      if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

      // The distinguishing proof: the OLD implementation looped `runWorldTick` locally and called
      // `setWorld` exactly ONCE for the whole batch (`lib/world/store.ts`'s `version` would advance
      // by exactly 1 regardless of `count`). Routing through `TickLoop.runTicks` means every one of
      // the 3 ticks commits its OWN `setWorld` — the version advances by exactly the tick count.
      expect(getWorldVersion()).toBe(startVersion + 3);

      // The broadcast throttle (`BROADCAST_MIN_INTERVAL_MS`) may coalesce the 3 ticks' emits into
      // fewer than 3 deliveries, but never into zero — wait past the throttle window before
      // asserting "silence" would be a false negative. The old implementation never touched
      // `tickLoop.subscribe` at all, so `seen` would stay empty forever, not just briefly.
      await new Promise((resolve) => setTimeout(resolve, 300));
      unsubscribe();

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.at(-1)).toBe(result.data.newTick);
    });
  });
});

describe("inspectWorld", () => {
  it("returns meta and entity counts matching the live world", () => {
    const result = inspectWorld();
    if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

    expect(result.data.meta).toEqual(world.meta);
    expect(result.data.counts.systems).toBe(world.systems.length);
    expect(result.data.counts.regions).toBe(world.regions.length);
    expect(result.data.counts.markets).toBe(world.markets.length);
    expect(result.data.counts.factions).toBe(world.factions.length);
    expect(result.data.nextId).toBe(world.nextId);
  });
});

describe("getEconomySnapshot", () => {
  it("returns systems sorted by name with market entries", () => {
    const result = getEconomySnapshot();
    if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

    expect(result.data.systems.length).toBe(world.systems.length);
    const names = result.data.systems.map((s) => s.systemName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // Sorting is asserted above; the market-entries assertion needs a system known to be
    // developed (most systems are not, under habitability-seeding), so pick one from the live
    // world state rather than assuming the alphabetically-first entry is settled.
    const developed = world.systems.find((s) => s.control === "developed")!;
    const developedEntry = result.data.systems.find((s) => s.systemId === developed.id);
    expect(developedEntry).toBeDefined();
    if (!developedEntry) return;
    expect(developedEntry.markets.length).toBeGreaterThan(0);
    const food = developedEntry.markets.find((m) => m.goodId === "food");
    expect(food).toBeDefined();
    expect(Number.isFinite(food?.price)).toBe(true);
    expect(Number.isFinite(food?.stock)).toBe(true);
  });
});

describe("no-world guard", () => {
  beforeEach(() => {
    clearWorld();
  });

  it("spawnEvent returns ok:false when no world is loaded", () => {
    const result = spawnEvent({ systemId: "any-system", eventType: "solar_storm" });
    expect(result.ok).toBe(false);
  });

  it("resetEconomy returns ok:false when no world is loaded", () => {
    const result = resetEconomy();
    expect(result.ok).toBe(false);
  });

  it("advanceTicks returns ok:false when no world is loaded", async () => {
    const result = await advanceTicks(2);
    expect(result.ok).toBe(false);
  });

  it("getEconomySnapshot returns ok:false when no world is loaded", () => {
    const result = getEconomySnapshot();
    expect(result.ok).toBe(false);
  });

  it("inspectWorld returns ok:false when no world is loaded", () => {
    const result = inspectWorld();
    expect(result.ok).toBe(false);
  });
});
