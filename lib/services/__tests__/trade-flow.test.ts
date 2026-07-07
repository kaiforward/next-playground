import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemLogistics, getTradeFlowEdges } from "@/lib/services/trade-flow";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import type { World, WorldSystem } from "@/lib/world/types";

// Imports/exports are summed over the flow window then normalised to a per-economy-cycle
// rate (so they share units with production/consumption). Expected values follow suit.
const cyclesInWindow = TRADE_SIMULATION.FLOW_HISTORY_TICKS / ECONOMY_UPDATE_INTERVAL;
const perCycle = (windowTotal: number): number => windowTotal / cyclesInWindow;

let world: World;
let system: WorldSystem; // focal
let partnerA: WorldSystem;
let partnerB: WorldSystem;

beforeEach(() => {
  const generated = generateWorld({ systemCount: 60, seed: 16 });
  const byPop = [...generated.systems].sort((a, b) => b.population - a.population);
  [system, partnerA, partnerB] = byPop;

  // Cross-border flows on the focal system, inside the history window.
  // WorldFlowEvent.goodId stores the good KEY. Water EXPORTS to partnerA
  // (market + logistics); food IMPORTS from both partners.
  world = {
    ...generated,
    meta: { ...generated.meta, currentTick: 10 },
    flowEvents: [
      { tick: 9, fromSystemId: system.id, toSystemId: partnerA.id, goodId: "water", quantity: 4, flowType: "market" },
      { tick: 10, fromSystemId: system.id, toSystemId: partnerA.id, goodId: "water", quantity: 2, flowType: "logistics" },
      { tick: 9, fromSystemId: partnerB.id, toSystemId: system.id, goodId: "food", quantity: 3, flowType: "market" },
      { tick: 10, fromSystemId: partnerA.id, toSystemId: system.id, goodId: "food", quantity: 1, flowType: "logistics" },
    ],
  };
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getSystemLogistics", () => {
  it("assembles the logistics readout, split by flow type", () => {
    const data = getSystemLogistics(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    // Exports split by flow type, no inbound flow (window totals 4 + 2, per cycle).
    const water = data.rows.find((r) => r.goodId === "water")!;
    expect(water.exportMarket).toBeCloseTo(perCycle(4));
    expect(water.exportLogistics).toBeCloseTo(perCycle(2));
    expect(water.importMarket).toBe(0);
    expect(water.importLogistics).toBe(0);
    expect(water.externalNet).toBeCloseTo(perCycle(6));
    expect(water.traded).toBe(true);

    // Imports split by flow type, summed across both source partners (window totals 3 + 1).
    const food = data.rows.find((r) => r.goodId === "food")!;
    expect(food.importMarket).toBeCloseTo(perCycle(3));
    expect(food.importLogistics).toBeCloseTo(perCycle(1));
    expect(food.exportMarket).toBe(0);
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
          flowType: "market",
        },
      ],
    });
    const data = getSystemLogistics(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.tradedGoodCount).toBe(0);
  });
});

describe("getTradeFlowEdges", () => {
  it("aggregates window flows into market and logistics edge sets", () => {
    // The per-good window total must clear ROUTE_INFERENCE_FLOOR for the edge
    // to render — inject a flow comfortably above it.
    setWorld({
      ...world,
      flowEvents: [
        { tick: 9, fromSystemId: system.id, toSystemId: partnerA.id, goodId: "water", quantity: 40, flowType: "market" },
      ],
    });
    const edges = getTradeFlowEdges();

    const marketEdge = edges.marketEdges.find(
      (e) =>
        (e.fromSystemId === system.id && e.toSystemId === partnerA.id) ||
        (e.fromSystemId === partnerA.id && e.toSystemId === system.id),
    );
    expect(marketEdge).toBeDefined();
    expect(marketEdge!.totalVolume).toBeGreaterThan(0);
  });
});
