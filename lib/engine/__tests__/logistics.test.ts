import { describe, it, expect } from "vitest";
import {
  buildLogisticsRows,
  aggregateLogisticsFlows,
  type GoodFlowAggregate,
} from "@/lib/engine/logistics";
import type { SystemFlowRow } from "@/lib/engine/system-trade-flow";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";

const agg = (p: Partial<GoodFlowAggregate>): GoodFlowAggregate => ({
  importLogistics: 0, exportLogistics: 0,
  importPartners: [], exportPartners: [], ...p,
});

describe("buildLogisticsRows", () => {
  // water t0 (+8), ore t0 (0), food t0 (-3), alloys t1 (-3)
  const prodCon: SubstrateGoodRate[] = [
    { goodId: "ore", production: 5, consumption: 5 },
    { goodId: "water", production: 10, consumption: 2 },
    { goodId: "food", production: 1, consumption: 4 },
    { goodId: "alloys", production: 0, consumption: 3 },
  ];

  it("groups by tier ascending, then net descending within tier", () => {
    const model = buildLogisticsRows(prodCon, new Map());
    expect(model.rows.map((r) => r.goodId)).toEqual(["water", "ore", "food", "alloys"]);
  });

  it("computes internal/external net and the traded flag", () => {
    const flows = new Map<string, GoodFlowAggregate>([
      ["water", agg({ exportLogistics: 6 })],
      ["food", agg({ importLogistics: 4 })],
    ]);
    const model = buildLogisticsRows(prodCon, flows);
    const water = model.rows.find((r) => r.goodId === "water")!;
    expect(water.internalNet).toBe(8);
    expect(water.externalNet).toBe(6);
    expect(water.traded).toBe(true);
    const ore = model.rows.find((r) => r.goodId === "ore")!;
    expect(ore.traded).toBe(false);
    const food = model.rows.find((r) => r.goodId === "food")!;
    expect(food.externalNet).toBe(-4);
  });

  it("normalizes each column to its own max, and counts active/traded goods", () => {
    const flows = new Map<string, GoodFlowAggregate>([
      ["water", agg({ exportLogistics: 6 })], // export total 6
      ["food", agg({ importLogistics: 4 })], // import total 4
    ]);
    const model = buildLogisticsRows(prodCon, flows);
    expect(model.internalMax).toBe(10); // water production
    expect(model.externalMax).toBe(6); // water export total
    expect(model.activeGoodCount).toBe(4);
    expect(model.tradedGoodCount).toBe(2);
  });

  it("includes a trade-only good with no prod/con, and drops fully-inactive goods", () => {
    const prod: SubstrateGoodRate[] = [{ goodId: "ore", production: 0, consumption: 0 }];
    const flows = new Map<string, GoodFlowAggregate>([
      ["chemicals", agg({ importLogistics: 5 })],
    ]);
    const model = buildLogisticsRows(prod, flows);
    expect(model.rows.map((r) => r.goodId)).toEqual(["chemicals"]); // ore dropped (no activity)
    // The lone trade-only good drives the model aggregates: no internal activity,
    // external scale = its 5-unit import, counted as traded but not active.
    expect(model.internalMax).toBe(0);
    expect(model.externalMax).toBe(5);
    expect(model.activeGoodCount).toBe(0);
    expect(model.tradedGoodCount).toBe(1);
  });

  it("resolves display name and tier", () => {
    const model = buildLogisticsRows([{ goodId: "water", production: 1, consumption: 0 }], new Map());
    expect(model.rows[0].goodName).toBe("Water");
    expect(model.rows[0].tier).toBe(0);
  });

  it("folds manufacturing input demand into total consumption and the internal net", () => {
    // gas: produces 287, civilian need 200, manufacturing input draw 985 → a net importer once
    // industrial consumption is counted (the civilian-only figure hid this).
    const pc: SubstrateGoodRate[] = [{ goodId: "gas", production: 287, consumption: 200 }];
    const model = buildLogisticsRows(pc, new Map(), 1, new Map([["gas", 985]]));
    const gas = model.rows.find((r) => r.goodId === "gas")!;
    expect(gas.consumption).toBe(200); // civilian portion kept separate
    expect(gas.inputDemand).toBe(985); // manufacturing portion surfaced
    expect(gas.internalNet).toBe(287 - 1185); // net of TOTAL local demand
    expect(model.internalMax).toBe(1185); // bar scale uses total consumption, not civilian alone
  });

  it("counts a good consumed only as a manufacturing input as active", () => {
    // minerals: no civilian need, no production, but drawn 50/cyc as a factory input → must show.
    const model = buildLogisticsRows([], new Map(), 1, new Map([["minerals", 50]]));
    const minerals = model.rows.find((r) => r.goodId === "minerals");
    expect(minerals?.inputDemand).toBe(50);
    expect(model.activeGoodCount).toBe(1);
  });

  it("normalises imports/exports (and partners) to a per-cycle rate, leaving prod/con untouched", () => {
    const flows = new Map<string, GoodFlowAggregate>([
      ["water", agg({
        exportLogistics: 60, // window total
        exportPartners: [{ systemId: "A", systemName: "A", quantity: 60 }],
      })],
    ]);
    const model = buildLogisticsRows(prodCon, flows, 8); // 8 cycles in the window
    const water = model.rows.find((r) => r.goodId === "water")!;
    // imports/exports divided by 8; production/consumption (per-cycle already) unchanged
    expect(water.exportLogistics).toBe(7.5);
    expect(water.externalNet).toBe(7.5);
    expect(water.production).toBe(10);
    expect(water.consumption).toBe(2);
    expect(water.exportPartners[0].quantity).toBe(7.5);
    expect(model.externalMax).toBe(7.5); // per-cycle export rate, not the 60 window total
  });
});

describe("aggregateLogisticsFlows", () => {
  const SYS = "sys1";
  const resolveName = (id: string) => `${id}-name`;
  const flows: SystemFlowRow[] = [
    { tick: 1, fromSystemId: SYS, toSystemId: "A", goodId: "water", quantity: 4 },
    { tick: 2, fromSystemId: SYS, toSystemId: "B", goodId: "water", quantity: 2 },
    { tick: 3, fromSystemId: "C", toSystemId: SYS, goodId: "food", quantity: 3 },
    { tick: 4, fromSystemId: "C", toSystemId: SYS, goodId: "food", quantity: 1 },
  ];

  it("sums per-good imports and exports", () => {
    const out = aggregateLogisticsFlows(flows, SYS, resolveName);
    expect(out.get("water")).toMatchObject({ exportLogistics: 6, importLogistics: 0 });
    expect(out.get("food")).toMatchObject({ importLogistics: 4, exportLogistics: 0 });
  });

  it("ranks partners by quantity with resolved names", () => {
    const out = aggregateLogisticsFlows(flows, SYS, resolveName);
    expect(out.get("water")!.exportPartners).toEqual([
      { systemId: "A", systemName: "A-name", quantity: 4 },
      { systemId: "B", systemName: "B-name", quantity: 2 },
    ]);
    expect(out.get("food")!.importPartners).toEqual([
      { systemId: "C", systemName: "C-name", quantity: 4 },
    ]);
  });

  it("caps partners at the top 3 by quantity", () => {
    const many: SystemFlowRow[] = [
      { tick: 1, fromSystemId: SYS, toSystemId: "P1", goodId: "ore", quantity: 1 },
      { tick: 1, fromSystemId: SYS, toSystemId: "P2", goodId: "ore", quantity: 5 },
      { tick: 1, fromSystemId: SYS, toSystemId: "P3", goodId: "ore", quantity: 3 },
      { tick: 1, fromSystemId: SYS, toSystemId: "P4", goodId: "ore", quantity: 4 },
      { tick: 1, fromSystemId: SYS, toSystemId: "P5", goodId: "ore", quantity: 2 },
    ];
    const out = aggregateLogisticsFlows(many, SYS, resolveName);
    // 5 distinct destinations collapse to the 3 highest-volume partners, qty-desc.
    expect(out.get("ore")!.exportPartners).toEqual([
      { systemId: "P2", systemName: "P2-name", quantity: 5 },
      { systemId: "P4", systemName: "P4-name", quantity: 4 },
      { systemId: "P3", systemName: "P3-name", quantity: 3 },
    ]);
  });

  it("ignores non-positive quantities", () => {
    const out = aggregateLogisticsFlows(
      [{ tick: 1, fromSystemId: SYS, toSystemId: "A", goodId: "ore", quantity: 0 }],
      SYS, resolveName,
    );
    expect(out.has("ore")).toBe(false);
  });
});
