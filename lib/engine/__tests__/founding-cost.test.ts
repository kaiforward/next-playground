/**
 * Founding cost — the valuation seam and the charter/commitment quotes.
 *
 * ⚠ The S-invariance case here is LOAD-BEARING and cannot be delegated to the rest of the suite:
 * every other unit test runs pinned at ECONOMY_SCALE=1 (vitest.config.ts), where a missing
 * `/ economyScale` divisor in `foundingGoodsValue` reads correct. At the live S=100 the same
 * manifest would price ~100× and the affordability gate would freeze founding galaxy-wide. The
 * re-import at each scale is required because the goods QUANTITY itself rides S through
 * `scaleRecord` — comparing the two arms is only meaningful if both the quantity and the divisor
 * are re-resolved.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";

// Load the founding-cost graph fresh at a chosen ECONOMY_SCALE. resetModules clears the module
// cache so economy-scale.ts (and every scaleRecord downstream of it) re-reads the stubbed env.
async function loadAtScale(scale: string) {
  vi.resetModules();
  vi.stubEnv("ECONOMY_SCALE", scale);
  const foundingCost = await import("@/lib/engine/founding-cost");
  const colonisation = await import("@/lib/constants/colonisation");
  return { foundingCost, colonisation };
}

/** A source market row — only `goodId` is read by the projection; the rest is band state. */
function market(goodId: string): GoodMarketState {
  return {
    goodId,
    stock: 100,
    logisticsTarget: 50,
    donorReserve: 20,
    demand: 5,
    drawDemand: 5,
    civilianDemand: 5,
    production: 5,
    capacityProduction: 5,
  };
}

// A plausible founder: the survival goods, a couple of tiers up, and one good that exists as a
// market row but nothing in the catalog consumes — it must never reach a cost line.
const SOURCE_GOODS: GoodMarketState[] = [
  market("water"),
  market("food"),
  market("medicine"),
  market("ship_frames"),
  market("not_a_real_good"),
];

const SEED_POP = 2;
/** A founding-era-scale maintenance bill, well clear of the CHARTER_FEE_MIN floor. */
const MAINTENANCE_BILL = 91.6;

/** The full price of one colony at a given scale, quoted exactly as the gate quotes it. */
function priceColony(mods: Awaited<ReturnType<typeof loadAtScale>>, scale: number) {
  const { projectedManifestWant, foundingGoodsValue, charterFee, foundingCommitmentCost } =
    mods.foundingCost;
  const { COLONISATION } = mods.colonisation;

  const want = projectedManifestWant(SOURCE_GOODS, SEED_POP, COLONISATION.FOUNDING_STOCK_COVER);
  const materials = foundingGoodsValue(want, scale);
  const charter = charterFee(MAINTENANCE_BILL, {
    mult: COLONISATION.CHARTER_FEE_SPEND_MULT,
    min: COLONISATION.CHARTER_FEE_MIN,
  });
  return {
    want,
    tonnage: want.reduce((sum, l) => sum + l.quantity, 0),
    materials,
    charter,
    total: foundingCommitmentCost(charter, materials, COLONISATION.FOUNDING_GATE_HEADROOM),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("founding cost — ECONOMY_SCALE invariance", () => {
  it("prices the same colony identically at S=1 and S=100", async () => {
    const base = priceColony(await loadAtScale("1"), 1);
    const x100 = priceColony(await loadAtScale("100"), 100);

    // The premise: the manifest QUANTITY rides S. Without this the money comparison below would
    // pass vacuously on a seam that never divides.
    expect(x100.tonnage).toBeCloseTo(base.tonnage * 100, 6);

    // The money does not.
    expect(x100.materials).toBeCloseTo(base.materials, 6);
    expect(x100.charter).toBeCloseTo(base.charter, 6);
    expect(x100.total).toBeCloseTo(base.total, 6);

    // And it is a real price, not a zero that would satisfy any invariance.
    expect(base.materials).toBeGreaterThan(0);
    expect(base.total).toBeGreaterThan(base.charter);
  });

  it("projects the want for every good the seed consumes, and only those", async () => {
    const base = priceColony(await loadAtScale("1"), 1);
    expect(base.want.map((l) => l.goodId)).toEqual(["water", "food", "medicine", "ship_frames"]);
    expect(base.want.every((l) => l.quantity > 0)).toBe(true);
  });
});

describe("charterFee", () => {
  it("scales with the maintenance bill above the floor", async () => {
    const { charterFee } = await import("@/lib/engine/founding-cost");
    expect(charterFee(200, { mult: 6.5, min: 100 })).toBeCloseTo(1300, 6);
  });

  it("floors a collapsed bill at min rather than falling back to it only at zero", async () => {
    const { charterFee } = await import("@/lib/engine/founding-cost");
    // A real max(): a small-but-nonzero bill still pays the floor.
    expect(charterFee(5, { mult: 6.5, min: 100 })).toBe(100);
    expect(charterFee(0, { mult: 6.5, min: 100 })).toBe(100);
  });
});

describe("referenceMaintenanceBill", () => {
  it("de-scales the stored per-settlement bill to one reference cycle", async () => {
    const { referenceMaintenanceBill } = await import("@/lib/engine/founding-cost");
    const { REFERENCE_INTERVAL } = await import("@/lib/constants/tick-cadence");
    // At the reference cadence the stored figure IS the reference figure.
    expect(referenceMaintenanceBill(600, REFERENCE_INTERVAL)).toBeCloseTo(600, 6);
    // Settle half as often and each settlement's bill covers twice the ground — a charter quoted
    // off the raw figure would double for no reason but granularity.
    expect(referenceMaintenanceBill(600, REFERENCE_INTERVAL * 2)).toBeCloseTo(300, 6);
    expect(referenceMaintenanceBill(600, REFERENCE_INTERVAL / 2)).toBeCloseTo(1200, 6);
  });

  it("reads no settlement yet as zero, and never divides by a zero cadence", async () => {
    const { referenceMaintenanceBill } = await import("@/lib/engine/founding-cost");
    expect(referenceMaintenanceBill(undefined, 24)).toBe(0);
    // An Infinity here would reach world state as null and corrupt the save.
    expect(referenceMaintenanceBill(600, 0)).toBe(600);
  });
});

describe("foundingCommitmentCost", () => {
  it("reserves headroom on the projected bill on top of the charter", async () => {
    const { foundingCommitmentCost } = await import("@/lib/engine/founding-cost");
    expect(foundingCommitmentCost(595, 195, 2)).toBeCloseTo(985, 6);
  });
});
