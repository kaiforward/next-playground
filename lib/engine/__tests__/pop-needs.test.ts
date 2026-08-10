import { describe, expect, it } from "vitest";
import { computePopNeeds } from "@/lib/engine/pop-needs";
import { dissatisfaction, provision, grievanceShortfall } from "@/lib/engine/population";
import { GOOD_CONSUMPTION, GOOD_NECESSITY } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";
import { EXPECTATION_PARAMS } from "@/lib/constants/population";

const basis = { population: 1000, technicians: 50, engineers: 10 };

/** Two consumed goods with a real per-capita need, one big one small (by base rate). */
const consumedIds = Object.keys(GOOD_CONSUMPTION)
  .filter((id) => GOOD_CONSUMPTION[id] > 0 && GOODS[id])
  .sort((a, b) => GOOD_CONSUMPTION[b] - GOOD_CONSUMPTION[a]);
const bigGood = consumedIds[0];
const smallGood = consumedIds[consumedIds.length - 1];

describe("computePopNeeds — stored satisfaction", () => {
  it("reads the persisted flow, not a stock recompute", () => {
    const needs = computePopNeeds(basis, [{ goodId: bigGood, satisfaction: 0.6 }]);
    const fed = needs.find((n) => n.goodId === bigGood)!;
    // The share is over want × necessity, rebuilt from the shipped table so a weight change moves
    // this oracle rather than silently invalidating it.
    const totalWeight = needs.reduce((s, n) => s + n.want * GOOD_NECESSITY[n.goodId], 0);
    const share = (fed.want * GOOD_NECESSITY[bigGood]) / totalWeight;
    expect(fed.satisfaction).toBeCloseTo(0.6, 5);
    expect(fed.delivered).toBeCloseTo(fed.want * 0.6, 5);
    expect(fed.pressure).toBeCloseTo(share * 0.4, 5);
  });

  it("treats a missing satisfaction field as fully served (pre-change save)", () => {
    const needs = computePopNeeds(basis, [{ goodId: bigGood }]);
    const fed = needs.find((n) => n.goodId === bigGood)!;
    expect(fed.satisfaction).toBe(1);
    expect(fed.delivered).toBeCloseTo(fed.want, 5);
  });

  it("treats a wanted good with no market row as satisfaction 0", () => {
    const needs = computePopNeeds(basis, []);
    const anyNeed = needs.find((n) => n.goodId === bigGood)!;
    expect(anyNeed.satisfaction).toBe(0);
    expect(anyNeed.delivered).toBe(0);
  });

  it("clamps an out-of-range persisted satisfaction into [0,1]", () => {
    const over = computePopNeeds(basis, [{ goodId: bigGood, satisfaction: 1.4 }]);
    const under = computePopNeeds(basis, [{ goodId: smallGood, satisfaction: -0.2 }]);
    expect(over.find((n) => n.goodId === bigGood)!.satisfaction).toBe(1);
    expect(under.find((n) => n.goodId === smallGood)!.satisfaction).toBe(0);
  });

  it("pressures use necessity-weighted shares (sum over goods of share = 1 when all fully starved)", () => {
    const needs = computePopNeeds(basis, consumedIds.map((id) => ({ goodId: id, satisfaction: 0 })));
    const total = needs.reduce((s, n) => s + n.pressure, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("ranks an unmet high-necessity good above an unmet low-necessity one, matching the simulation", () => {
    // The ledger's sort key is the panel's ordering AND the API's "contribution to unrest". If it
    // weighted raw want it would rank luxuries above medicine while the fold ranks the opposite.
    const engineerBasis = { population: 1000, technicians: 0, engineers: 200 };
    const needs = computePopNeeds(engineerBasis, [
      { goodId: "medicine", satisfaction: 0 },
      { goodId: "luxuries", satisfaction: 0 },
    ]);
    const medicine = needs.find((n) => n.goodId === "medicine")!;
    const luxuries = needs.find((n) => n.goodId === "luxuries")!;
    // The engineer basket wants MORE luxuries than medicine, so raw want inverts the ranking.
    expect(luxuries.want).toBeGreaterThan(medicine.want);
    expect(medicine.pressure).toBeGreaterThan(luxuries.pressure);
  });

  it("excludes goods this basis does not want", () => {
    const zeroBasis = { population: 0, technicians: 0, engineers: 0 };
    expect(computePopNeeds(zeroBasis, [{ goodId: bigGood, satisfaction: 1 }])).toEqual([]);
  });

  it("sums to the fold over the same basket", () => {
    // pressure is `dissatisfaction()`'s own per-good term (pop-needs.ts:9-11) — summed over the
    // basket, it must equal calling dissatisfaction() directly on the equivalent GoodSatisfaction[].
    // A re-implemented sum on either side is the drift this proves.
    const basis = { population: 1000, technicians: 20, engineers: 5 };
    const markets = consumedIds.map((id, i) => ({ goodId: id, satisfaction: [0.9, 0.6, 0.3, 0.75][i % 4] }));
    const needs = computePopNeeds(basis, markets);
    const totalPressure = needs.reduce((sum, n) => sum + n.pressure, 0);
    const asGoods = needs.map((n) => ({ goodId: n.goodId, satisfaction: n.satisfaction, demanded: n.want }));
    expect(totalPressure).toBeCloseTo(dissatisfaction(asGoods), 10);
  });

  it("stays the absolute per-good decomposition — non-zero even where grievance (memory vs Provision) is zero", () => {
    // The unrest spine now integrates grievance, not this pressure fold — this pins that pressure
    // did NOT move to track grievance instead. Fixture: one shallow gap (water) in an otherwise
    // fully-served basket keeps Provision near 1, so a floored, well-below-Provision remembered
    // expectation reads zero grievance — the world isn't grieving — while water's absolute gap is
    // still real. A pressure implementation that read a G-based (relative) reading instead of the
    // absolute gap would report 0 here.
    const markets = consumedIds.map((id) => ({ goodId: id, satisfaction: id === "water" ? 0.8 : 1 }));
    const needs = computePopNeeds(basis, markets);
    const water = needs.find((n) => n.goodId === "water")!;
    const asGoods = needs.map((n) => ({ goodId: n.goodId, satisfaction: n.satisfaction, demanded: n.want }));
    const p = provision(asGoods);
    const grievance = grievanceShortfall(EXPECTATION_PARAMS.floor, p);
    expect(grievance).toBe(0); // memory well below this near-full Provision — nothing to grieve
    expect(water.pressure).toBeGreaterThan(0); // but the absolute gap is real and pressure reports it
  });

  it("ranking inverts for the case that motivated the coupling: linear favours the shallow, high-weight, high-volume good over a deep gap in a negligible one", () => {
    // Under the old squared shape, a deep gap in a negligible good (luxuries, necessity 0.05) could
    // outrank a shallow gap in a high-necessity, high-volume good (water, necessity 1.0) once the gap
    // shrank enough to be squared away. The un-squared shape can't do that — it's exactly the weighted
    // mean, so a big enough weight advantage always wins. A heavily-skilled basis (engineers >>
    // technicians) keeps luxuries' own weight non-trivial, so the two shapes actually disagree here
    // rather than both trivially favouring water.
    const skilledBasis = { population: 1000, technicians: 0, engineers: 780 };
    const markets = consumedIds.map((id) => {
      if (id === "water") return { goodId: id, satisfaction: 0.7 }; // shallow gap, high weight
      if (id === "luxuries") return { goodId: id, satisfaction: 0 }; // deep gap, negligible good
      return { goodId: id, satisfaction: 1 }; // everything else fully met — contributes no pressure
    });
    const needs = computePopNeeds(skilledBasis, markets);
    const water = needs.find((n) => n.goodId === "water")!;
    const luxuries = needs.find((n) => n.goodId === "luxuries")!;
    expect(water.pressure).toBeGreaterThan(luxuries.pressure);
  });
});

describe("computePopNeeds — what enters the list, and in what order", () => {
  it("drops every good the basis wants none of, rather than listing it at want 0", () => {
    // A technician-only basis (no civilians, no engineers) wants exactly the technician basket. Food
    // is wanted by nobody here, and a zero-want row would dilute every share below it.
    const techniciansOnly = { population: 0, technicians: 10, engineers: 0 };
    const needs = computePopNeeds(techniciansOnly, []);
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((n) => n.want > 0)).toBe(true);
    expect(needs.some((n) => n.goodId === "food")).toBe(false);
    // The same basket WITH civilians does carry food, so it is the basis and not the catalogue.
    expect(computePopNeeds({ ...techniciansOnly, population: 1000 }, []).some((n) => n.goodId === "food"))
      .toBe(true);
  });

  it("sorts by descending pressure, breaking ties on descending want", () => {
    const withEveryone = { population: 1000, technicians: 50, engineers: 10 };
    // Two readings: one where nothing is delivered (pressures spread across the necessity weights)
    // and one where everything is (every pressure 0, so the want tiebreak carries the whole order).
    const starved = computePopNeeds(withEveryone, []);
    const fed = computePopNeeds(withEveryone, starved.map((n) => ({ goodId: n.goodId, satisfaction: 1 })));
    expect(starved.length).toBeGreaterThan(3);
    expect(new Set(starved.map((n) => n.pressure)).size).toBeGreaterThan(1); // pressures really do differ
    expect(new Set(fed.map((n) => n.pressure))).toEqual(new Set([0]));       // and really do all tie
    for (const needs of [starved, fed]) {
      for (let i = 1; i < needs.length; i++) {
        const prev = needs[i - 1]!;
        const cur = needs[i]!;
        expect(prev.pressure, `${prev.goodId} before ${cur.goodId}`).toBeGreaterThanOrEqual(cur.pressure);
        if (prev.pressure === cur.pressure) {
          expect(prev.want, `${prev.goodId} before ${cur.goodId}`).toBeGreaterThanOrEqual(cur.want);
        }
      }
    }
  });
});
