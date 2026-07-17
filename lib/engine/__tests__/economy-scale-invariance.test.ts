/**
 * Static ECONOMY_SCALE invariance — the magnitude constants + the seed/pricing path, priced through
 * the real market band at S=1 vs S=100.
 *
 * ⚠ One of the two LOAD-BEARING invariance-bridge tests (with the dynamic
 * lib/world/__tests__/economy-scale-dynamic-invariance.test.ts). Together they are the proof that
 * makes the whole suite's S=1 pin (vitest.config.ts `env.ECONOMY_SCALE`) valid for the S=100 game:
 * weaken or delete either and every magnitude assertion in the suite silently becomes meaningless.
 * See vitest.config.ts for the full note.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Load the constants-magnitude graph fresh at a chosen ECONOMY_SCALE. resetModules
// clears the module cache so economy-scale.ts re-reads the stubbed env at import.
async function loadAtScale(scale: string) {
  vi.resetModules();
  vi.stubEnv("ECONOMY_SCALE", scale);
  const physical = await import("@/lib/constants/physical-economy");
  const market = await import("@/lib/constants/market-economy");
  const industryConsts = await import("@/lib/constants/industry");
  const logistics = await import("@/lib/constants/directed-logistics");
  const industryEngine = await import("@/lib/engine/industry");
  const pricing = await import("@/lib/engine/market-pricing");
  return { physical, market, industryConsts, logistics, industryEngine, pricing };
}

// A representative market priced through the real seed/pricing path. demandRate
// uses GOOD_CONSUMPTION + MIN_DEMAND; storageCapacity uses the storage constants;
// the stock sits inside the band (a deficit) so midPriceAt is unclamped.
function scenario(mods: Awaited<ReturnType<typeof loadAtScale>>) {
  const { market, industryConsts, industryEngine, pricing } = mods;
  const pop = 1000;
  const buildings: Record<string, number> = { food: 10, [industryConsts.HOUSING_TYPE]: 5 };

  const popOnly = { population: pop, technicians: 0, engineers: 0 };
  const demandFood = market.civilianDemandRateForGood("food", popOnly);             // need-driven
  const demandFloored = market.civilianDemandRateForGood("ship_frames", { population: 1, technicians: 0, engineers: 0 }); // MIN_DEMAND-floored
  const storageCapacity = industryEngine.facilityStorageForGood(buildings, "food");

  // Basket-good demand with skilled work: luxuries scale through consumptionRate's
  // SKILL2_CONSUMPTION term, which rides ECONOMY_SCALE the same as GOOD_CONSUMPTION
  // (both flow through scaleRecord).
  const demandLuxuriesSkilled = market.civilianDemandRateForGood("luxuries", { population: pop, technicians: 0, engineers: 200 });

  const band = pricing.marketBand({
    demandRate: demandFood,
    storageCapacity,
    priceFloor: 0.5,
    priceCeiling: 2.0,
  });
  const stock = band.targetStock * 0.8; // in-band deficit
  const price = pricing.midPriceAt(
    { basePrice: 100, targetStock: band.targetStock, floorMult: 0.5, ceilingMult: 2.0 },
    stock,
  );

  return {
    demandFood,
    demandFloored,
    demandLuxuriesSkilled,
    storageCapacity,
    targetStock: band.targetStock,
    maxStock: band.maxStock,
    stock,
    price,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ECONOMY_SCALE invariance", () => {
  it("scales every wired magnitude by S", async () => {
    const base = await loadAtScale("1");
    const x10 = await loadAtScale("10");

    // Raw constant wiring.
    expect(x10.physical.GOOD_CONSUMPTION.water).toBeCloseTo(base.physical.GOOD_CONSUMPTION.water * 10);
    expect(x10.market.MIN_DEMAND).toBeCloseTo(base.market.MIN_DEMAND * 10);
    expect(x10.industryConsts.OUTPUT_PER_UNIT.food).toBeCloseTo(base.industryConsts.OUTPUT_PER_UNIT.food * 10);
    expect(x10.industryConsts.EXTRACTOR_STORAGE_PER_UNIT).toBeCloseTo(base.industryConsts.EXTRACTOR_STORAGE_PER_UNIT * 10);
    expect(x10.industryConsts.PRODUCTION_STORAGE_PER_UNIT).toBeCloseTo(base.industryConsts.PRODUCTION_STORAGE_PER_UNIT * 10);
    expect(x10.industryConsts.POP_CENTRE_STORAGE_DEFAULT).toBeCloseTo(base.industryConsts.POP_CENTRE_STORAGE_DEFAULT * 10);
    expect(x10.industryConsts.POP_CENTRE_STORAGE.food).toBeCloseTo(base.industryConsts.POP_CENTRE_STORAGE.food * 10);
    expect(x10.logistics.DIRECTED_LOGISTICS.GENERATION_PER_POP).toBeCloseTo(base.logistics.DIRECTED_LOGISTICS.GENERATION_PER_POP * 10);
  });

  it("scales derived magnitudes by S and leaves price invariant", async () => {
    const base = scenario(await loadAtScale("1"));
    const x10 = scenario(await loadAtScale("10"));

    expect(x10.demandFood).toBeCloseTo(base.demandFood * 10);     // GOOD_CONSUMPTION rides S
    expect(x10.demandFloored).toBeCloseTo(base.demandFloored * 10); // MIN_DEMAND floor rides S
    expect(x10.demandLuxuriesSkilled).toBeCloseTo(base.demandLuxuriesSkilled * 10); // SKILL2_CONSUMPTION basket rides S
    expect(x10.storageCapacity).toBeCloseTo(base.storageCapacity * 10);
    expect(x10.targetStock).toBeCloseTo(base.targetStock * 10);
    expect(x10.maxStock).toBeCloseTo(base.maxStock * 10);
    expect(x10.stock).toBeCloseTo(base.stock * 10);

    expect(x10.price).toBeCloseTo(base.price); // INVARIANT — the equilibrium-preservation proof
  });
});
