import { describe, it, expect } from "vitest";
import {
  headsTaxIncome,
  productionTaxIncome,
  maintenanceBill,
  settleLadder,
  bandShortfall,
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

  it("values realised units at reference values, normalised by economy scale", () => {
    const realised = new Map([["ore", 200], ["alloys", 100]]);
    // at S=100: (200/100)*30 + (100/100)*50 = 110; x rate 0.05 x mult 1 = 5.5
    expect(productionTaxIncome(realised, REF, 0.05, 1, 100)).toBeCloseTo(5.5);
  });

  it("is ECONOMY_SCALE-invariant when units scale with S", () => {
    const atS1 = productionTaxIncome(new Map([["ore", 2]]), REF, 0.05, 1, 1);
    const atS100 = productionTaxIncome(new Map([["ore", 200]]), REF, 0.05, 1, 100);
    expect(atS100).toBeCloseTo(atS1);
  });

  it("skips goods with no reference value and non-finite units", () => {
    const realised = new Map([["mystery_good", 100], ["ore", NaN]]);
    expect(productionTaxIncome(realised, REF, 0.05, 1, 1)).toBe(0);
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

  it("reports what each band was ASKED to pay, out of range clamped exactly as the ladder applies it", () => {
    // `charged` is what makes insolvency decidable from the settlement alone: a band is insolvent
    // iff `paid < charged`, and both are fixed at the same instant. Maintenance is asked for its full
    // bill and pays it; construction is asked for half of a 40 bill and the ladder runs out of money
    // at 10 — the shortfall that a comparison against the slider alone could not distinguish from a
    // deliberate half-funding. An out-of-range slider is clamped, so `charged` never exceeds the bill.
    const sliders: TreasuryBands = { maintenance: 1, logistics: 1, construction: 0.5 };
    const r = settleLadder(0, 40, { maintenance: 30, logistics: 0, construction: 40 }, sliders);
    expect(r.charged).toEqual({ maintenance: 30, logistics: 0, construction: 20 });
    expect(r.paid.maintenance).toBe(30);
    expect(r.paid.construction).toBe(10);

    const overRange = settleLadder(0, 1000, { maintenance: 30, logistics: 0, construction: 0 },
      { maintenance: 4, logistics: 1, construction: 1 });
    expect(overRange.charged.maintenance).toBe(30);
  });

  it("never goes negative and coerces non-finite inputs to 0", () => {
    const r = settleLadder(NaN, Infinity, { maintenance: NaN, logistics: 5, construction: 5 }, FULL);
    expect(Number.isFinite(r.balance)).toBe(true);
    expect(r.balance).toBeGreaterThanOrEqual(0);
    expect(r.paid.maintenance).toBe(0);
  });
});

describe("bandShortfall", () => {
  // Every fixture here is a settlement ALONE — the function takes no slider argument, which is the
  // structural half of the fix: there is no seam across which a live policy value could be compared
  // with a frozen outcome, because the caller has nothing live to hand it.
  const settled = (paid: TreasuryBands, charged?: TreasuryBands) => ({ paid, charged });
  const bands = (maintenance: number, logistics: number, construction: number): TreasuryBands =>
    ({ maintenance, logistics, construction });

  it("is null for a band that paid what it was asked, however far below its full bill that was", () => {
    // The half-funded case: a legal slider at 0.5 charges half the bill and the faction pays all of
    // it. Solvent on every band — and the player raising a slider afterwards cannot reach this
    // reading, because nothing here can see today's slider.
    const s = settled(bands(50, 10, 5), bands(50, 10, 5));
    expect(bandShortfall(s, "maintenance")).toBeNull();
    expect(bandShortfall(s, "logistics")).toBeNull();
    expect(bandShortfall(s, "construction")).toBeNull();
  });

  it("reports the shortfall amount for a band the ladder could not fully pay", () => {
    // Maintenance was asked 100 and paid 60; the two lower rungs got nothing they were asked for.
    const s = settled(bands(60, 0, 0), bands(100, 20, 40));
    expect(bandShortfall(s, "maintenance")).toBeCloseTo(40);
    expect(bandShortfall(s, "logistics")).toBeCloseTo(20);
    expect(bandShortfall(s, "construction")).toBeCloseTo(40);
  });

  it("is null for a band charged nothing at all — an unbilled band is not an unfunded one", () => {
    const s = settled(bands(0, 0, 0), bands(0, 0, 0));
    expect(bandShortfall(s, "construction")).toBeNull();
  });

  it("is null for a settlement predating the charge, and for no settlement at all", () => {
    // An older save carries `paid` with no record of what was asked. Guessing from the live slider
    // is the fault this function removes, so absent reads as never-assessed and the next settlement
    // fills it in — even where the paid figures alone would look short against a full slider.
    expect(bandShortfall(settled(bands(50, 0, 0)), "maintenance")).toBeNull();
    expect(bandShortfall(null, "maintenance")).toBeNull();
    expect(bandShortfall(undefined, "maintenance")).toBeNull();
  });

  it("agrees exactly with settleLadder's own output — no float residue on a fully funded band", () => {
    // The end-to-end guarantee the callers rest on: run the real ladder, and a band it funded in
    // full reads null rather than a hairline positive. `pay = min(charge, available)` hands back the
    // identical value, so the comparison needs no epsilon — pinned here rather than assumed.
    const sliders: TreasuryBands = { maintenance: 0.5, logistics: 0.3, construction: 0.7 };
    const full = settleLadder(0, 1000, { maintenance: 30, logistics: 20, construction: 40 }, sliders);
    expect(bandShortfall(full, "maintenance")).toBeNull();
    expect(bandShortfall(full, "logistics")).toBeNull();
    expect(bandShortfall(full, "construction")).toBeNull();

    // Same bills and sliders, income that runs out inside the construction rung.
    const starved = settleLadder(0, 30, { maintenance: 30, logistics: 20, construction: 40 }, sliders);
    expect(bandShortfall(starved, "maintenance")).toBeNull(); // 15 asked, 15 paid
    expect(bandShortfall(starved, "logistics")).toBeNull();   // 6 asked, 6 paid
    expect(bandShortfall(starved, "construction")).toBeCloseTo(19); // 28 asked, 9 left
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

describe("treasury — per-term arithmetic and the input guards", () => {
  it("multiplies each grade's heads by its own weight", () => {
    // The default fixture weights unskilled at 1, where a division reads the same. Weight it at 2.
    const heavy = { unskilled: 2, technicians: 3, engineers: 9 };
    // weighted = 100×2 + 10×3 + 1×9 = 239
    expect(headsTaxIncome({ unskilled: 100, technicians: 10, engineers: 1 }, heavy, 0.01, 1))
      .toBeCloseTo(2.39, 6);
  });

  it("applies the production rate multiplier as a multiplier", () => {
    const realised = new Map([["ore", 200]]);
    const once = productionTaxIncome(realised, { ore: 30 }, 0.05, 1, 1);
    expect(productionTaxIncome(realised, { ore: 30 }, 0.05, 2, 1)).toBeCloseTo(once * 2, 6);
  });

  it("treats an unusable economy scale as no scaling rather than dividing by it", () => {
    const realised = new Map([["ore", 200]]);
    const unscaled = productionTaxIncome(realised, { ore: 30 }, 0.05, 1, 1);
    for (const scale of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(productionTaxIncome(realised, { ore: 30 }, 0.05, 1, scale), `scale ${scale}`)
        .toBeCloseTo(unscaled, 6);
    }
  });

  it("ignores a negative realised quantity rather than crediting it against the tax base", () => {
    const realised = new Map([["ore", 200], ["alloys", -1000]]);
    expect(productionTaxIncome(realised, { ore: 30, alloys: 50 }, 0.05, 1, 1))
      .toBeCloseTo(productionTaxIncome(new Map([["ore", 200]]), { ore: 30 }, 0.05, 1, 1), 6);
  });

  it("itemises only the lines that actually cost something", () => {
    const result = maintenanceBill(new Map([["housing", 0], ["ore", 5]]), 0.002);
    expect(result.byType.map((l) => l.buildingType)).toEqual(["ore"]);
  });
});
