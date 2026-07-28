import { describe, expect, it } from "vitest";
import { computePopNeeds } from "@/lib/engine/pop-needs";
import { GOOD_CONSUMPTION, GOOD_NECESSITY } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";

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
    expect(fed.pressure).toBeCloseTo(share * 0.4 * 0.4, 5);
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
});
