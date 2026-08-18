import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemLogistics, getTradeFlowEdges } from "@/lib/services/trade-flow";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import type { World, WorldSystem } from "@/lib/world/types";
import { capacityGoodRates, computeSystemLabourSnapshot, inputDemandForGood } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { yieldsOf } from "@/lib/engine/resources";

// Imports/exports are summed over the flow window then normalised to a
// per-REFERENCE_INTERVAL rate (so they share units with production/consumption, which are
// reference-denominated). Deriving the divisor from a cadence knob instead would agree only
// while that knob equals REFERENCE_INTERVAL — see buildLogisticsRows' docstring.
const referenceCyclesInWindow = TRADE_SIMULATION.FLOW_HISTORY_TICKS / REFERENCE_INTERVAL;
const perCycle = (windowTotal: number): number => windowTotal / referenceCyclesInWindow;

let world: World;
let system: WorldSystem; // focal
let partnerA: WorldSystem;
let partnerB: WorldSystem;

beforeEach(() => {
  const generated = generateWorld({ systemCount: 60, seed: 16 });
  const byPop = [...generated.systems].sort((a, b) => b.population - a.population);
  [system, partnerA, partnerB] = byPop;

  // Cross-border flows on the focal system, inside the history window.
  // WorldFlowEvent.goodId stores the good KEY. Water EXPORTS to partnerA;
  // food IMPORTS from both partners.
  world = {
    ...generated,
    meta: { ...generated.meta, currentTick: 10 },
    flowEvents: [
      { tick: 9, fromSystemId: system.id, toSystemId: partnerA.id, goodId: "water", quantity: 4 },
      { tick: 10, fromSystemId: system.id, toSystemId: partnerA.id, goodId: "water", quantity: 2 },
      { tick: 9, fromSystemId: partnerB.id, toSystemId: system.id, goodId: "food", quantity: 3 },
      { tick: 10, fromSystemId: partnerA.id, toSystemId: system.id, goodId: "food", quantity: 1 },
    ],
  };
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getSystemLogistics", () => {
  it("assembles the logistics readout with per-good imports and exports", () => {
    const data = getSystemLogistics(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    // Exports only, no inbound flow (window total 4 + 2, per cycle).
    const water = data.rows.find((r) => r.goodId === "water")!;
    expect(water.exportLogistics).toBeCloseTo(perCycle(6));
    expect(water.importLogistics).toBe(0);
    expect(water.externalNet).toBeCloseTo(perCycle(6));
    expect(water.traded).toBe(true);

    // Imports summed across both source partners (window total 3 + 1).
    const food = data.rows.find((r) => r.goodId === "food")!;
    expect(food.importLogistics).toBeCloseTo(perCycle(4));
    expect(food.exportLogistics).toBe(0);
    expect(food.externalNet).toBeCloseTo(perCycle(-4));
    expect(food.traded).toBe(true);

    expect(data.tradedGoodCount).toBe(2);
    // No top-N cap: the full prod/con footprint of a populated system is returned.
    expect(data.activeGoodCount).toBeGreaterThan(5);
    expect(data.internalMax).toBeGreaterThan(0);
    expect(data.externalMax).toBeCloseTo(perCycle(6));

    // Volume history covers the window and carries the seeded throughput.
    const totalVolume = data.volumeHistory.reduce((s, b) => s + b.importVolume + b.exportVolume, 0);
    expect(totalVolume).toBeGreaterThan(0);
  });

  it("names every trade partner (fog-of-war returns in Phase 3)", () => {
    const data = getSystemLogistics(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");

    const water = data.rows.find((r) => r.goodId === "water")!;
    expect(water.exportPartners.find((p) => p.systemId === partnerA.id)!.systemName).toBe(partnerA.name);

    const food = data.rows.find((r) => r.goodId === "food")!;
    expect(food.importPartners.find((p) => p.systemId === partnerB.id)!.systemName).toBe(partnerB.name);
    expect(food.importPartners.find((p) => p.systemId === partnerA.id)!.systemName).toBe(partnerA.name);
  });

  it("returns { visibility: 'unknown' } for a nonexistent system", () => {
    const data = getSystemLogistics("does-not-exist");
    expect(data).toEqual({ visibility: "unknown" });
  });

  it("carries the system's own civilian consumption onto every logistics row", () => {
    // The row's `consumption` is the service's capacityGoodRates pass; derive it independently from
    // the system's building-derived labour basis so the wiring stays pinned to a real value.
    const data = getSystemLogistics(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");

    const buildings: Record<string, number> = {};
    for (const b of world.buildings) {
      if (b.systemId === system.id) buildings[b.buildingType] = b.count;
    }
    const { basis } = computeSystemLabourSnapshot(buildings, system.population);

    expect(data.rows.length).toBeGreaterThan(0);
    for (const row of data.rows) {
      expect(row.consumption, row.goodId).toBeCloseTo(consumptionRate(row.goodId, basis), 10);
    }
    // Non-vacuous: a populated system genuinely draws at least one good.
    expect(data.rows.some((r) => r.consumption > 0)).toBe(true);
  });

  it("reads the industrial column off the shared use figure, gated by the row's strike scalar", () => {
    // The panel must show the same standing draw the matcher and the planner size against; a second
    // capacity computation living in the service is exactly how the two drift apart. Under a strike
    // the column falls with the industry, and equals the persisted use figure minus civilian want.
    const suppress = 0.4;
    setWorld({
      ...world,
      markets: world.markets.map((m) =>
        m.systemId === system.id ? { ...m, productionSuppressRate: suppress } : m,
      ),
    });

    const data = getSystemLogistics(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");

    const buildings: Record<string, number> = {};
    for (const b of world.buildings) {
      if (b.systemId === system.id) buildings[b.buildingType] = b.count;
    }
    const snap = computeSystemLabourSnapshot(buildings, system.population);

    for (const row of data.rows) {
      const expected = inputDemandForGood(buildings, row.goodId, snap.state, yieldsOf(system)) * suppress;
      expect(row.inputDemand, row.goodId).toBeCloseTo(expected, 9);
    }
    // Non-vacuous: this world genuinely has industry drawing recipe inputs.
    expect(data.rows.some((r) => r.inputDemand > 0)).toBe(true);

    // Production carries the same suppress scalar, so both halves of internalNet describe the
    // same operating state — a striking world must not show full output beside a gated draw.
    const capacity = new Map(
      capacityGoodRates(buildings, system.population, yieldsOf(system))
        .map((r) => [r.goodId, r.production]),
    );
    for (const row of data.rows) {
      expect(row.production, row.goodId).toBeCloseTo((capacity.get(row.goodId) ?? 0) * suppress, 9);
    }
    expect(data.rows.some((r) => r.production > 0)).toBe(true);
  });

  it("excludes flows older than the history window", () => {
    setWorld({
      ...world,
      flowEvents: [
        {
          tick: 10 - TRADE_SIMULATION.FLOW_HISTORY_TICKS,
          fromSystemId: system.id,
          toSystemId: partnerA.id,
          goodId: "water",
          quantity: 99,
        },
      ],
    });
    const data = getSystemLogistics(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.tradedGoodCount).toBe(0);
  });
});

describe("getTradeFlowEdges", () => {
  it("aggregates window flows into the logistics edge set", () => {
    // The per-good window total must clear LOGISTICS_ROUTE_FLOOR for the edge
    // to render — inject a logistics flow comfortably above it.
    setWorld({
      ...world,
      flowEvents: [
        { tick: 9, fromSystemId: system.id, toSystemId: partnerA.id, goodId: "water", quantity: 40 },
      ],
    });
    const edges = getTradeFlowEdges();

    const logisticsEdge = edges.logisticsEdges.find(
      (e) =>
        (e.fromSystemId === system.id && e.toSystemId === partnerA.id) ||
        (e.fromSystemId === partnerA.id && e.toSystemId === system.id),
    );
    expect(logisticsEdge).toBeDefined();
    expect(logisticsEdge!.totalVolume).toBeGreaterThan(0);
  });
});
