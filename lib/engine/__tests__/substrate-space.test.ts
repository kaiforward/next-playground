import { describe, it, expect } from "vitest";
import type { RNG } from "../universe-gen";
import { partitionBody, rollQualityBand, bandForMultiplier, depositDisplayName } from "../substrate-space";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { QUALITY_BANDS, SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { RESOURCE_TYPES } from "../resources";

// Volatility is OFF when rng() >= VOLATILITY_CHANCE (0.04).
// rng = () => 0.5  →  0.5 >= 0.04  →  no spike. Safe for all non-volatility tests.
const rngOff: RNG = () => 0.5;

// Volatility is ON when rng() < VOLATILITY_CHANCE (0.04).
// rng = () => 0.01  →  0.01 < 0.04  →  spike fires.
// Second call picks the spiked resource: floor(0.01 * present.length) = 0 → first present resource.
const rngOn: RNG = () => 0.01;

describe("partitionBody", () => {
  it("availableSpace equals SPACE_PER_SIZE × size", () => {
    const arch = BODY_ARCHETYPES.garden_world;
    const size = 3;
    const result = partitionBody(arch, size, rngOff);
    expect(result.availableSpace).toBe(SUBSTRATE_GEN.SPACE_PER_SIZE * size);
  });

  it("partition is exhaustive: Σ depositSpace[r] + generalSpace === availableSpace (within ε)", () => {
    const arch = BODY_ARCHETYPES.volcanic_world;
    const size = 2;
    const result = partitionBody(arch, size, rngOff);
    let sum = result.generalSpace;
    for (const r of RESOURCE_TYPES) {
      sum += result.depositSpace[r];
    }
    expect(Math.abs(sum - result.availableSpace)).toBeLessThan(1e-9);
  });

  it("slots[r] === depositSpace[r] / DEPOSIT_SLOT_FOOTPRINT", () => {
    const arch = BODY_ARCHETYPES.asteroid_belt;
    const size = 1;
    const result = partitionBody(arch, size, rngOff);
    for (const r of RESOURCE_TYPES) {
      expect(result.slots[r]).toBeCloseTo(
        result.depositSpace[r] / SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT,
        10,
      );
    }
  });

  it("habitableSpace === habitableFraction × generalSpace", () => {
    const arch = BODY_ARCHETYPES.ocean_world;
    const size = 4;
    const result = partitionBody(arch, size, rngOff);
    expect(result.habitableSpace).toBeCloseTo(
      arch.habitableFraction * result.generalSpace,
      10,
    );
  });

  it("a resource with weight 0 on the archetype gets slots[r] === 0", () => {
    // gas_giant has gas:3, water:1 — no arable or radioactive weight
    const arch = BODY_ARCHETYPES.gas_giant;
    const size = 2;
    const result = partitionBody(arch, size, rngOff);
    expect(result.slots.arable).toBe(0);
    expect(result.slots.radioactive).toBe(0);
    expect(result.depositSpace.arable).toBe(0);
    expect(result.depositSpace.radioactive).toBe(0);
  });

  it("no ordering bias: two equal-weight resources get equal slots", () => {
    // garden_world has minerals: 1, ore: 1 — genuine equal-weight pair
    const arch = BODY_ARCHETYPES.garden_world;
    const size = 3;
    const result = partitionBody(arch, size, rngOff);
    expect(result.slots.minerals).toBeCloseTo(result.slots.ore, 10);
  });

  it("volatility: one resource spikes; partition still sums to availableSpace (within ε)", () => {
    // garden_world present resources (weight > 0): minerals, ore, biomass, arable, water
    // rngOn = () => 0.01 → volatility fires (0.01 < 0.04), then picks index 0 of present list
    const arch = BODY_ARCHETYPES.garden_world;
    const size = 2;
    const result = partitionBody(arch, size, rngOn);

    // Partition is still exhaustive after the spike
    let sum = result.generalSpace;
    for (const r of RESOURCE_TYPES) {
      sum += result.depositSpace[r];
    }
    expect(Math.abs(sum - result.availableSpace)).toBeLessThan(1e-9);

    // Exactly one resource's share spikes under volatility
    const baseline = partitionBody(arch, size, rngOff);
    const spiked = RESOURCE_TYPES.filter(
      (r) => result.slots[r] > baseline.slots[r] + 1e-9,
    );
    expect(spiked).toEqual(["minerals"]); // exactly one resource's share spikes, and it's the first present resource
  });
});

describe("rollQualityBand", () => {
  it("returns a multiplier within the picked band's [min, max]", () => {
    // Total weight = 100. rng() = 0.25 on first call → roll = 0.25*100 = 25
    // Cumulative: poor=25, so roll-=25 → roll≤0, picks "poor" (min=0.4, max=0.7).
    // Second call = 0.5 → multiplier = 0.4 + 0.5*(0.7-0.4) = 0.55
    const seq = [0.25, 0.5];
    const rng: RNG = () => seq.shift() ?? 0;
    const result = rollQualityBand(rng);
    const band = QUALITY_BANDS.find((b) => b.id === result.band)!;
    expect(result.multiplier).toBeGreaterThanOrEqual(band.min);
    expect(result.multiplier).toBeLessThanOrEqual(band.max);
    expect(result.band).toBe("poor");
    expect(result.multiplier).toBeCloseTo(0.55, 10);
  });

  it("picks each band at the correct roll thresholds", () => {
    // Total weight = 100. Bands: poor=25, average=45 (cum 70), good=22 (cum 92), rich=8 (cum 100).
    // First rng() selects band; second rng()=0 gives band.min.
    const pickBand = (firstRoll: number) => {
      const seq = [firstRoll, 0];
      const rng: RNG = () => seq.shift() ?? 0;
      return rollQualityBand(rng).band;
    };
    // roll = 0.249*100 = 24.9 → poor (after deducting 25, roll becomes -0.1 ≤ 0)
    expect(pickBand(0.249)).toBe("poor");
    // roll = 0.26*100 = 26 → after poor: 26-25=1 > 0 → average (1-45=-44 ≤ 0)
    expect(pickBand(0.26)).toBe("average");
    // roll = 0.71*100 = 71 → after poor+average: 71-25-45=1 > 0 → good (1-22=-21 ≤ 0)
    expect(pickBand(0.71)).toBe("good");
    // roll = 0.93*100 = 93 → after poor+average+good: 93-25-45-22=1 > 0 → rich (1-8=-7 ≤ 0)
    expect(pickBand(0.93)).toBe("rich");
  });
});

describe("bandForMultiplier", () => {
  it("round-trips: multiplier rolled from band b maps back to b", () => {
    // Use several deterministic (band-pick, multiplier-offset) pairs
    const seeds: Array<[number, number]> = [
      [0.1, 0.0],   // poor, at min
      [0.1, 1.0],   // poor, at max
      [0.3, 0.5],   // average, midpoint
      [0.72, 0.5],  // good, midpoint
      [0.95, 0.5],  // rich, midpoint
    ];
    for (const [s1, s2] of seeds) {
      const seq = [s1, s2];
      const rng: RNG = () => seq.shift() ?? 0;
      const r = rollQualityBand(rng);
      expect(bandForMultiplier(r.multiplier)).toBe(r.band);
    }
  });

  it("maps a value inside each band's [min,max] to that band", () => {
    // Sample the midpoint of each band directly
    for (const b of QUALITY_BANDS) {
      const mid = (b.min + b.max) / 2;
      expect(bandForMultiplier(mid)).toBe(b.id);
    }
    // Also test exact min values
    expect(bandForMultiplier(0.4)).toBe("poor");
    expect(bandForMultiplier(0.8)).toBe("average");
    expect(bandForMultiplier(1.4)).toBe("good");
    expect(bandForMultiplier(1.9)).toBe("rich");
  });
});

describe("depositDisplayName", () => {
  it("returns a non-empty string containing 'ore' for ('ore', 'rich')", () => {
    const name = depositDisplayName("ore", "rich");
    expect(name.length).toBeGreaterThan(0);
    expect(/ore/i.test(name)).toBe(true);
  });

  it("is generic generated text — not a proper noun from the retired richness catalog", () => {
    const name = depositDisplayName("ore", "rich");
    // Old catalog nouns: Forge, Veins, Lode, etc. — none should appear
    expect(/forge/i.test(name)).toBe(false);
    expect(/veins/i.test(name)).toBe(false);
  });

  it("covers all resources and all bands without throwing", () => {
    const resources = ["gas", "minerals", "ore", "biomass", "arable", "water", "radioactive"] as const;
    const bands = ["poor", "average", "good", "rich"] as const;
    for (const r of resources) {
      for (const b of bands) {
        const name = depositDisplayName(r, b);
        expect(name.length).toBeGreaterThan(0);
        // Each result must contain the resource name it describes
        const expected = r === "minerals" ? "mineral" : r;
        expect(name.toLowerCase()).toContain(expected);
      }
    }
  });
});
