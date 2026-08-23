import { describe, it, expect } from "vitest";
import {
  RESOURCE_CLOSURE,
  factionMissingResources,
  factionSaturation,
  unblockedDemandByResource,
  colonyValue,
  type FactionSystemState,
  type ColonyCandidate,
  type ColonyValueParams,
  type GoodDeficit,
} from "@/lib/engine/colonisation-value";
import { emptyResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { HOUSING_TYPE, effectiveSpaceCost } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import { generateWorld } from "@/lib/world/gen";
import type { ResourceType } from "@/lib/types/game";

describe("RESOURCE_CLOSURE", () => {
  it("maps a tier-0 good to its own resource", () => {
    expect([...RESOURCE_CLOSURE.ore]).toEqual(["ore"]);
    expect([...RESOURCE_CLOSURE.radioactives]).toEqual(["radioactive"]);
  });

  it("maps a tier-1 good to the union of its inputs' resources", () => {
    // alloys = metals(→ore) + minerals(→minerals)
    expect(new Set(RESOURCE_CLOSURE.alloys)).toEqual(new Set(["ore", "minerals"]));
  });

  it("traces a deep tier-2 chain down to its deposits", () => {
    // reactor_cores = radioactives(→radioactive) + alloys(→ore,minerals) + components(→minerals,ore)
    expect(new Set(RESOURCE_CLOSURE.reactor_cores)).toEqual(
      new Set(["radioactive", "ore", "minerals"]),
    );
  });
});

function sys(over: Partial<FactionSystemState>): FactionSystemState {
  return { buildings: {}, peopleLand: 0, depositCounts: emptyResourceVector(), ...over };
}

describe("factionMissingResources", () => {
  it("returns resources with zero depositCounts across developed systems", () => {
    const oreOnly = sys({ depositCounts: { ...emptyResourceVector(), ore: 5 } });
    const missing = factionMissingResources([oreOnly]);
    expect(missing.has("ore")).toBe(false);
    expect(missing.has("radioactive")).toBe(true);
    expect(missing.has("gas")).toBe(true);
  });

  it("treats a resource present on ANY developed system as not missing", () => {
    const a = sys({ depositCounts: { ...emptyResourceVector(), ore: 5 } });
    const b = sys({ depositCounts: { ...emptyResourceVector(), gas: 3 } });
    const missing = factionMissingResources([a, b]);
    expect(missing.has("ore")).toBe(false);
    expect(missing.has("gas")).toBe(false);
    expect(missing.has("radioactive")).toBe(true);
  });
});

describe("factionSaturation", () => {
  it("is ~0 when habitable land is mostly unbuilt", () => {
    // 100 habitable / housing cost 1 → 2000 potential pop-cap; 0 housing built → σ ≈ 0
    expect(factionSaturation([sys({ peopleLand: 100 })])).toBeCloseTo(0, 5);
  });

  it("is 1 when housing fills the habitable land", () => {
    // 100 housing × POP_CENTRE_DENSITY(20) = 2000 built = 2000 potential → σ = 1
    expect(
      factionSaturation([sys({ peopleLand: 100, buildings: { [HOUSING_TYPE]: 100 } })]),
    ).toBeCloseTo(1, 5);
  });

  it("treats zero habitable potential as fully saturated", () => {
    expect(factionSaturation([sys({ peopleLand: 0 })])).toBe(1);
  });
});

describe("unblockedDemandByResource", () => {
  it("attributes a blocked good's deficit to its single missing gating resource", () => {
    // metals needs ore; ore missing → ore gets the full deficit
    const m = unblockedDemandByResource(
      [{ goodId: "metals", rateDeficit: 10 }],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.get("ore")).toBeCloseTo(10, 5);
  });

  it("splits a deficit equally across two missing gating resources", () => {
    // alloys → {ore, minerals}; both missing → 5 each
    const m = unblockedDemandByResource(
      [{ goodId: "alloys", rateDeficit: 10 }],
      new Set<ResourceType>(["ore", "minerals"]),
    );
    expect(m.get("ore")).toBeCloseTo(5, 5);
    expect(m.get("minerals")).toBeCloseTo(5, 5);
  });

  it("ignores a good whose gating resources the faction already has", () => {
    // metals needs ore; nothing missing → no attribution
    const m = unblockedDemandByResource([{ goodId: "metals", rateDeficit: 10 }], new Set());
    expect(m.size).toBe(0);
  });

  it("ignores non-positive deficits", () => {
    const m = unblockedDemandByResource(
      [{ goodId: "metals", rateDeficit: 0 }],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.size).toBe(0);
  });

  it("accumulates across two different goods gated by the same missing resource", () => {
    // Only `ore` is missing. metals → {ore} (full 10). components → {minerals, ore} but only ore
    // is missing → full 10. Both attribute to ore and must SUM, not overwrite → 20.
    const m = unblockedDemandByResource(
      [
        { goodId: "metals", rateDeficit: 10 },
        { goodId: "components", rateDeficit: 10 },
      ],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.get("ore")).toBeCloseTo(20, 5);
  });
});

const PARAMS: ColonyValueParams = {
  landPremium: 0.4,
  landGeneralWeight: 0.1,
  landDepositWeight: 0.15,
  sigmaFloor: 0.25,
};

function candidate(over: Partial<ColonyCandidate>): ColonyCandidate {
  return { peopleLand: 0, industryLand: 0, depositCounts: emptyResourceVector(), ...over };
}

describe("colonyValue", () => {
  it("credits U for a missing resource the candidate supplies, even at σ=0", () => {
    const unblocked = new Map<ResourceType, number>([["radioactive", 12]]);
    const c = candidate({ depositCounts: { ...emptyResourceVector(), radioactive: 3 } });
    // U = 12; L = landDepositWeight(0.15) × depositRichness(3) = 0.45; landGate at σ=0 = sigmaFloor 0.25
    const v = colonyValue(c, unblocked, 0, PARAMS);
    expect(v).toBeCloseTo(12 + 0.45 * 0.25, 5);
    expect(v).toBeGreaterThan(0);
  });

  it("scales generic land value up with saturation via the σ_floor blend", () => {
    const c = candidate({ peopleLand: 100 }); // L = 0.4 × 100 = 40
    const atLow = colonyValue(c, new Map(), 0, PARAMS); // landGate 0.25 → 10
    const atHigh = colonyValue(c, new Map(), 1, PARAMS); // landGate 1 → 40
    expect(atLow).toBeCloseTo(10, 5);
    expect(atHigh).toBeCloseTo(40, 5);
    expect(atHigh).toBeGreaterThan(atLow);
  });

  it("σ_floor=0 makes generic land worthless until saturated; σ_floor=1 values it fully", () => {
    const c = candidate({ peopleLand: 100 });
    const tall = colonyValue(c, new Map(), 0, { ...PARAMS, sigmaFloor: 0 });
    const rush = colonyValue(c, new Map(), 0, { ...PARAMS, sigmaFloor: 1 });
    expect(tall).toBeCloseTo(0, 5);
    expect(rush).toBeCloseTo(40, 5);
  });

  it("sums only supplied resources into U, weights all three L terms, and clamps σ", () => {
    // Candidate supplies ore but NOT gas, so only ore's unblocked demand reaches U.
    const c = candidate({
      peopleLand: 10,
      industryLand: 20,
      depositCounts: { ...emptyResourceVector(), ore: 2 },
    });
    const unblocked = new Map<ResourceType, number>([
      ["ore", 8], // supplied → counts
      ["gas", 100], // NOT supplied → excluded by the depositCounts[r] > 0 filter
    ]);
    // U = 8 (ore only; gas is filtered out despite its large demand)
    // L = landPremium·10 + landGeneralWeight·20 + landDepositWeight·depositRichness(2)
    //   = 0.4·10 + 0.1·20 + 0.15·2 = 4 + 2 + 0.3 = 6.3
    // σ = clamp(1.5) = 1 → landGate = 0.25 + 0.75·1 = 1
    // value = 8 + 6.3·1 = 14.3
    expect(colonyValue(c, unblocked, 1.5, PARAMS)).toBeCloseTo(14.3, 5);
  });
});

describe("factionSaturation — the potential is a pop-cap, not a land area", () => {
  it("converts habitable land into pop-cap at POP_CENTRE_DENSITY per whole level", () => {
    // 100 habitable ÷ housing footprint 1 = 100 levels = 2000 potential pop-cap; 50 levels built
    // = 1000 built pop-cap ⇒ σ = 0.5. Dividing by the density instead would read a saturated faction.
    expect(
      factionSaturation([sys({ peopleLand: 100, buildings: { [HOUSING_TYPE]: 50 } })]),
    ).toBeCloseTo(0.5, 5);
  });
});

/**
 * On a REPRESENTATIVE candidate set — every naturally-generated, T4-floor-passing
 * candidate system across six seeds, not a hand-picked few — with the REAL production coefficients
 * (`COLONISATION.LAND_*`), the U term still leads and L is secondary. "Representative" for U means the
 * doc's own keystone case: a faction missing exactly ONE resource entirely, with demand sized off
 * `GOOD_CONSUMPTION` at the archetype table's own 10,000-pop anchor and zero production of every good
 * that resource gates (`RESOURCE_CLOSURE`) — the same derivation `bodies.ts` uses to author deposit
 * counts. Run once per resource (whichever the candidate actually supplies), at both σ=0 (the doc's
 * "grab it early" case) and σ=0.6 (mid-saturation) so the claim isn't cherry-picked to one saturation.
 */
describe("colonyValue: U leads, L is secondary (real coefficients, real candidates)", () => {
  const ANCHOR_POP = 10000;
  const floor = effectiveSpaceCost(HOUSING_TYPE);
  type CountKey = "countGas" | "countMinerals" | "countOre" | "countBiomass"
    | "countArable" | "countWater" | "countRadioactive";
  const countColumn: Record<ResourceType, CountKey> = {
    gas: "countGas", minerals: "countMinerals", ore: "countOre", biomass: "countBiomass",
    arable: "countArable", water: "countWater", radioactive: "countRadioactive",
  };

  // U is a goods-magnitude term (demand-rate) and so scales linearly with ECONOMY_SCALE; L is
  // physical land/deposit counts and does NOT (see COLONISATION.md / colonisation-value.ts header).
  // The suite pins ECONOMY_SCALE=1 for cheap fixture magnitudes (vitest.config.ts), but that pin is
  // sound only because the economy is S-invariant — L/U is NOT S-invariant, so this claim about their
  // relative magnitude must be checked at the shipped default (100, `.env`), not the test pin.
  // The 100 is a bare literal deliberately coupled to `.env`'s ECONOMY_SCALE default (no exported
  // constant exists to reference) — if the shipped default moves, this must move with it by hand.
  const REAL_ECONOMY_SCALE = 100;
  function deficitsGatedBy(missing: Set<ResourceType>): GoodDeficit[] {
    const out: GoodDeficit[] = [];
    for (const g of GOOD_NAMES) {
      const demand = (GOOD_CONSUMPTION[g] ?? 0) * (REAL_ECONOMY_SCALE / ECONOMY_SCALE) * ANCHOR_POP;
      if (demand <= 0) continue;
      if (RESOURCE_CLOSURE[g].some((r) => missing.has(r))) out.push({ goodId: g, rateDeficit: demand });
    }
    return out;
  }

  // Six seeds × 600 systems, natural-gen candidates only (peopleLand ≥ the T4 floor) — the same
  // population `npm run report:coherence` reads its habitable-land bands from.
  const SEEDS = [42, 1337, 7, 2026, 99, 555];
  const candidates: ColonyCandidate[] = [];
  for (const seed of SEEDS) {
    const world = generateWorld({ systemCount: 600, seed });
    const capitalIds = new Set(world.factions.map((f) => f.homeworldId));
    for (const s of world.systems) {
      if (capitalIds.has(s.id)) continue;
      if (s.peopleLand < floor) continue;
      const depositCounts = emptyResourceVector();
      for (const r of RESOURCE_TYPES) depositCounts[r] = s[countColumn[r]];
      candidates.push({ peopleLand: s.peopleLand, industryLand: s.industryLand, depositCounts });
    }
  }
  it("has a non-trivial representative candidate set (sanity, not the claim)", () => {
    expect(candidates.length).toBeGreaterThan(500);
  });

  // PER-RESOURCE, not pooled: common resources (arable/water/biomass sit on every habitable
  // archetype) dominate a pooled sample by sheer candidate count and would mask a genuinely bad
  // ratio on a rarer resource (radioactive: common on DEAD archetypes, but gates only a few
  // low-`GOOD_CONSUMPTION` goods) — a pooled median stayed < 1 even at the rejected
  // `LAND_DEPOSIT_WEIGHT` (39.5) that fails on radioactive specifically (median 1.45 at σ=0,
  // `temp/task11-debug4.ts`). The claim is checked per resource so no single keystone case hides.
  it.each([0, 0.6])("median L·landGate / U < 1 at σ=%s, for EVERY resource", (sigma) => {
    const landGate = COLONISATION.SIGMA_FLOOR + (1 - COLONISATION.SIGMA_FLOOR) * sigma;
    let resourcesChecked = 0;
    for (const missResource of RESOURCE_TYPES) {
      const missing = new Set<ResourceType>([missResource]);
      const unblocked = unblockedDemandByResource(deficitsGatedBy(missing), missing);
      const u = unblocked.get(missResource) ?? 0;
      if (u <= 0) continue; // this resource gates no consumed good — nothing to unblock, skip
      const ratios: number[] = [];
      for (const c of candidates) {
        if (c.depositCounts[missResource] <= 0) continue; // candidate doesn't supply it → U=0, not the claim under test
        const value = colonyValue(c, unblocked, sigma, {
          landPremium: COLONISATION.LAND_PREMIUM,
          landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
          landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
          sigmaFloor: COLONISATION.SIGMA_FLOOR,
        });
        const l = (value - u) / landGate; // value = u + l*landGate ⇒ l = (value - u) / landGate
        ratios.push((l * landGate) / u);
      }
      expect(ratios.length).toBeGreaterThan(50); // representative, not a handful of lucky picks
      ratios.sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      expect(median).toBeLessThan(1); // U leads on the median for THIS resource at this saturation
      resourcesChecked++;
    }
    expect(resourcesChecked).toBeGreaterThanOrEqual(6); // every gate-capable resource actually ran
  });
});

/**
 * The σ-gate arithmetic (`sigmaFloor + (1 − sigmaFloor)·σ`) is untouched by the
 * coefficient re-authoring — a contradiction check against the pre-Task-11 behaviour. `colonyValue`
 * factors as `U + L·landGate`; `landGate` depends only on σ and `sigmaFloor`, never on the land
 * coefficients. So for ANY two coefficient sets (the retired pre-rewrite ones and the new ones) on the
 * SAME candidate and σ, `landGate` recovered as `(value − U) / L` must be identical.
 */
describe("colonyValue: σ-gate arithmetic is independent of the land coefficients", () => {
  const c = candidate({ peopleLand: 200, industryLand: 90, depositCounts: makeVec({ ore: 5, water: 12 }) });
  const unblocked = new Map<ResourceType, number>([["ore", 30]]);

  function landGateOf(params: ColonyValueParams, sigma: number): number {
    const l = params.landPremium * c.peopleLand + params.landGeneralWeight * c.industryLand
      + params.landDepositWeight * (c.depositCounts.ore + c.depositCounts.water);
    const value = colonyValue(c, unblocked, sigma, params);
    const u = c.depositCounts.ore > 0 ? (unblocked.get("ore") ?? 0) : 0;
    return (value - u) / l;
  }

  const RETIRED_PARAMS: ColonyValueParams = {
    landPremium: 3.0, landGeneralWeight: 0.5, landDepositWeight: 4.0, sigmaFloor: COLONISATION.SIGMA_FLOOR,
  };
  const NEW_PARAMS: ColonyValueParams = {
    landPremium: COLONISATION.LAND_PREMIUM,
    landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
    landDepositWeight: 39.5,
    sigmaFloor: COLONISATION.SIGMA_FLOOR,
  };

  it.each([0, 0.25, 0.6, 1])("recovers the same landGate at σ=%s regardless of the L coefficients", (sigma) => {
    const expected = COLONISATION.SIGMA_FLOOR + (1 - COLONISATION.SIGMA_FLOOR) * sigma;
    expect(landGateOf(RETIRED_PARAMS, sigma)).toBeCloseTo(expected, 8);
    expect(landGateOf(NEW_PARAMS, sigma)).toBeCloseTo(expected, 8);
  });
});

function makeVec(over: Partial<Record<ResourceType, number>>): ReturnType<typeof emptyResourceVector> {
  return { ...emptyResourceVector(), ...over };
}
