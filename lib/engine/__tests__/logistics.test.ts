import { describe, it, expect } from "vitest";
import { buildLogisticsRows, type GoodFlowAggregate } from "@/lib/engine/logistics";
import { aggregateLogisticsFlows, type LogisticsFlowRow } from "@/lib/engine/logistics";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";

const agg = (p: Partial<GoodFlowAggregate>): GoodFlowAggregate => ({
  importMarket: 0, importLogistics: 0, exportMarket: 0, exportLogistics: 0,
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
      ["water", agg({ exportMarket: 4, exportLogistics: 2 })],
      ["food", agg({ importMarket: 3, importLogistics: 1 })],
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
      ["water", agg({ exportMarket: 4, exportLogistics: 2 })], // export total 6
      ["food", agg({ importMarket: 3, importLogistics: 1 })], // import total 4
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
      ["chemicals", agg({ importMarket: 5 })],
    ]);
    const model = buildLogisticsRows(prod, flows);
    expect(model.rows.map((r) => r.goodId)).toEqual(["chemicals"]); // ore dropped (no activity)
  });

  it("resolves display name and tier", () => {
    const model = buildLogisticsRows([{ goodId: "water", production: 1, consumption: 0 }], new Map());
    expect(model.rows[0].goodName).toBe("Water");
    expect(model.rows[0].tier).toBe(0);
  });
});

describe("aggregateLogisticsFlows", () => {
  const SYS = "sys1";
  const resolveName = (id: string) => `${id}-name`;
  const flows: LogisticsFlowRow[] = [
    { tick: 1, fromSystemId: SYS, toSystemId: "A", goodId: "water", quantity: 4, flowType: "market" },
    { tick: 2, fromSystemId: SYS, toSystemId: "B", goodId: "water", quantity: 2, flowType: "logistics" },
    { tick: 3, fromSystemId: "C", toSystemId: SYS, goodId: "food", quantity: 3, flowType: "market" },
    { tick: 4, fromSystemId: "C", toSystemId: SYS, goodId: "food", quantity: 1, flowType: "logistics" },
  ];

  it("splits exports/imports by flow type", () => {
    const out = aggregateLogisticsFlows(flows, SYS, resolveName);
    expect(out.get("water")).toMatchObject({ exportMarket: 4, exportLogistics: 2, importMarket: 0 });
    expect(out.get("food")).toMatchObject({ importMarket: 3, importLogistics: 1, exportMarket: 0 });
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

  it("ignores non-positive quantities", () => {
    const out = aggregateLogisticsFlows(
      [{ tick: 1, fromSystemId: SYS, toSystemId: "A", goodId: "ore", quantity: 0, flowType: "market" }],
      SYS, resolveName,
    );
    expect(out.has("ore")).toBe(false);
  });
});
