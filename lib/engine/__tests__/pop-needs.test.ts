import { describe, expect, it } from "vitest";
import { computePopNeeds, type PopNeedsMarketRow } from "@/lib/engine/pop-needs";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";

const basis = { population: 1000, technicians: 50, engineers: 10 };

/** Two consumed goods with a real per-capita need, one big one small (by base rate). */
const consumedIds = Object.keys(GOOD_CONSUMPTION)
  .filter((id) => GOOD_CONSUMPTION[id] > 0 && GOODS[id])
  .sort((a, b) => GOOD_CONSUMPTION[b] - GOOD_CONSUMPTION[a]);
const bigGood = consumedIds[0];
const smallGood = consumedIds[consumedIds.length - 1];

function row(goodId: string, stockAt: "min" | "target" | "mid"): PopNeedsMarketRow {
  const demandRate = consumptionRate(goodId, basis);
  const base = { goodId, demandRate, storageCapacity: 0, anchorMult: 1 };
  const band = marketBandForRow(base, GOODS[goodId]);
  const stock =
    stockAt === "min" ? band.minStock : stockAt === "target" ? band.targetStock : (band.minStock + band.targetStock) / 2;
  return { ...base, stock };
}

describe("computePopNeeds", () => {
  it("satisfaction is 1 at target stock, 0 at the band floor, delivered = want × satisfaction", () => {
    const needs = computePopNeeds(basis, [row(bigGood, "target"), row(smallGood, "min")]);
    const fed = needs.find((n) => n.goodId === bigGood)!;
    const starved = needs.find((n) => n.goodId === smallGood)!;
    expect(fed.satisfaction).toBeCloseTo(1, 5);
    expect(fed.delivered).toBeCloseTo(fed.want, 5);
    expect(starved.satisfaction).toBe(0);
    expect(starved.delivered).toBe(0);
    expect(fed.want).toBeCloseTo(consumptionRate(bigGood, basis), 5);
  });

  it("pressure weights by demand share: a big-demand moderate shortage outranks a small-demand deep one", () => {
    const needs = computePopNeeds(basis, [row(bigGood, "mid"), row(smallGood, "min")]);
    const big = needs.find((n) => n.goodId === bigGood)!;
    const small = needs.find((n) => n.goodId === smallGood)!;
    // big: huge share × moderate gap² ; small: tiny share × gap²=1 — the share term must dominate.
    expect(big.pressure).toBeGreaterThan(small.pressure);
  });

  it("pressures use demand shares (sum over goods of share = 1 when all fully starved)", () => {
    const needs = computePopNeeds(basis, consumedIds.map((id) => row(id, "min")));
    const total = needs.reduce((s, n) => s + n.pressure, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("excludes goods this basis does not want, and treats a missing market row as satisfaction 0", () => {
    const zeroBasis = { population: 0, technicians: 0, engineers: 0 };
    expect(computePopNeeds(zeroBasis, [row(bigGood, "target")])).toEqual([]);
    const needs = computePopNeeds(basis, []); // wanted goods, no market rows at all
    const anyNeed = needs.find((n) => n.goodId === bigGood)!;
    expect(anyNeed.satisfaction).toBe(0);
  });
});
