import { describe, it, expect } from "vitest";
import {
  headsTaxIncome,
  productionTaxIncome,
  maintenanceBill,
  settleLadder,
  maintenanceOutputMalus,
  maintenanceBufferScale,
  type TreasuryBands,
} from "@/lib/engine/treasury";

const WEIGHTS = { unskilled: 1, technicians: 3, engineers: 9 };
const FULL: TreasuryBands = { maintenance: 1, logistics: 1, construction: 1 };

describe("headsTaxIncome", () => {
  it("weights grades steeply and applies rate x multiplier", () => {
    const alloc = { unskilled: 100, technicians: 10, engineers: 1 };
    // weighted = 100*1 + 10*3 + 1*9 = 139
    expect(headsTaxIncome(alloc, WEIGHTS, 0.01, 1)).toBeCloseTo(1.39);
    expect(headsTaxIncome(alloc, WEIGHTS, 0.01, 1.5)).toBeCloseTo(2.085);
  });

  it("coerces non-finite head counts to 0", () => {
    expect(headsTaxIncome({ unskilled: NaN, technicians: 0, engineers: 0 }, WEIGHTS, 0.01, 1)).toBe(0);
  });
});

describe("productionTaxIncome", () => {
  const REF = { ore: 30, alloys: 50 };

  it("values realized units at reference values, normalised by economy scale", () => {
    const realized = new Map([["ore", 200], ["alloys", 100]]);
    // at S=100: (200/100)*30 + (100/100)*50 = 110; x rate 0.05 x mult 1 = 5.5
    expect(productionTaxIncome(realized, REF, 0.05, 1, 100)).toBeCloseTo(5.5);
  });

  it("is ECONOMY_SCALE-invariant when units scale with S", () => {
    const atS1 = productionTaxIncome(new Map([["ore", 2]]), REF, 0.05, 1, 1);
    const atS100 = productionTaxIncome(new Map([["ore", 200]]), REF, 0.05, 1, 100);
    expect(atS100).toBeCloseTo(atS1);
  });

  it("skips goods with no reference value and non-finite units", () => {
    const realized = new Map([["mystery_good", 100], ["ore", NaN]]);
    expect(productionTaxIncome(realized, REF, 0.05, 1, 1)).toBe(0);
  });

  it("skips goods with non-finite reference values", () => {
    expect(productionTaxIncome(new Map([["ore", 100]]), { ore: NaN }, 0.05, 1, 1)).toBe(0);
  });
});

describe("maintenanceBill", () => {
  it("charges standing levels weighted by embodied build work, itemised by type", () => {
    const levels = new Map([["housing", 10], ["ore", 5]]);
    const result = maintenanceBill(levels, 0.002);
    // housing: 10 levels x 8 work x 0.002 = 0.16; ore (tier-0 extractor): 5 x 12 x 0.002 = 0.12.
    expect(result.byType).toHaveLength(2);
    const housing = result.byType.find((l) => l.buildingType === "housing")!;
    const ore = result.byType.find((l) => l.buildingType === "ore")!;
    expect(housing.amount).toBeCloseTo(0.16);
    expect(ore.amount).toBeCloseTo(0.12);
    expect(result.total).toBeCloseTo(0.28);
  });
});

describe("settleLadder", () => {
  it("pays all bands in full when income covers everything", () => {
    const r = settleLadder(0, 100, { maintenance: 30, logistics: 20, construction: 40 }, FULL);
    expect(r.balance).toBeCloseTo(10);
    expect(r.funded).toEqual({ maintenance: 1, logistics: 1, construction: 1 });
  });

  it("shorts in reverse ladder order: construction starves before logistics before maintenance", () => {
    const r = settleLadder(0, 45, { maintenance: 30, logistics: 20, construction: 40 }, FULL);
    expect(r.paid.maintenance).toBeCloseTo(30);
    expect(r.paid.logistics).toBeCloseTo(15);
    expect(r.paid.construction).toBe(0);
    expect(r.funded.maintenance).toBe(1);
    expect(r.funded.logistics).toBeCloseTo(0.75);
    expect(r.funded.construction).toBe(0);
    expect(r.balance).toBe(0);
  });

  it("a slider charges only its fraction of the bill, and the paid fraction is the effective funding", () => {
    const sliders: TreasuryBands = { maintenance: 1, logistics: 1, construction: 0.5 };
    const r = settleLadder(0, 1000, { maintenance: 0, logistics: 0, construction: 40 }, sliders);
    expect(r.paid.construction).toBeCloseTo(20);
    expect(r.funded.construction).toBeCloseTo(0.5);
  });

  it("zero-bill guard: effective funding equals the slider, never 0/0", () => {
    const sliders: TreasuryBands = { maintenance: 0.8, logistics: 1, construction: 0.6 };
    const r = settleLadder(5, 0, { maintenance: 0, logistics: 0, construction: 0 }, sliders);
    expect(r.funded).toEqual({ maintenance: 0.8, logistics: 1, construction: 0.6 });
    expect(r.balance).toBe(5);
  });

  it("never goes negative and coerces non-finite inputs to 0", () => {
    const r = settleLadder(NaN, Infinity, { maintenance: NaN, logistics: 5, construction: 5 }, FULL);
    expect(Number.isFinite(r.balance)).toBe(true);
    expect(r.balance).toBeGreaterThanOrEqual(0);
    expect(r.paid.maintenance).toBe(0);
  });
});

describe("maintenanceOutputMalus", () => {
  it("is 1 at full funding and ramps linearly with the shortfall", () => {
    expect(maintenanceOutputMalus(1, 0.25)).toBe(1);
    expect(maintenanceOutputMalus(0.9, 0.25)).toBeCloseTo(0.975, 9);
    expect(maintenanceOutputMalus(0.5, 0.25)).toBeCloseTo(0.875, 9);
    expect(maintenanceOutputMalus(0, 0.25)).toBeCloseTo(0.75, 9);
  });
  it("clamps funding into [0,1] and treats non-finite funding as fully funded", () => {
    expect(maintenanceOutputMalus(1.7, 0.25)).toBe(1);
    expect(maintenanceOutputMalus(-2, 0.25)).toBeCloseTo(0.75, 9);
    expect(maintenanceOutputMalus(Number.NaN, 0.25)).toBe(1);
    expect(maintenanceOutputMalus(Number.POSITIVE_INFINITY, 0.25)).toBe(1);
  });
});

describe("maintenanceBufferScale", () => {
  it("hits 1.0 at the slider-range midpoint (0.75) so today's constants are the mid-scale point", () => {
    expect(maintenanceBufferScale(0.75, 0.25)).toBeCloseTo(1, 9);
  });
  it("is gentler than today at full funding and aggressive under insolvency", () => {
    expect(maintenanceBufferScale(1, 0.25)).toBeCloseTo(1.25, 9);
    expect(maintenanceBufferScale(0.5, 0.25)).toBeCloseTo(0.75, 9);
    expect(maintenanceBufferScale(0, 0.25)).toBeCloseTo(0.25, 9);
  });
  it("treats non-finite funding as fully funded", () => {
    expect(maintenanceBufferScale(Number.NaN, 0.25)).toBeCloseTo(1.25, 9);
  });
});
