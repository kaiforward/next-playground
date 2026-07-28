import { describe, it, expect } from "vitest";
import { consumptionRate, consumptionBreakdown } from "../physical-economy";
import type { CivilianDemandBasis } from "../physical-economy";
import {
  GOOD_CONSUMPTION,
  SKILL1_CONSUMPTION,
  SKILL2_CONSUMPTION,
} from "@/lib/constants/physical-economy";

const popOnly = (population: number): CivilianDemandBasis => ({
  population,
  technicians: 0,
  engineers: 0,
});

describe("consumptionRate", () => {
  it("scales linearly with population at zero skilled work (baseline preserved)", () => {
    const single = consumptionRate("food", popOnly(100));
    const triple = consumptionRate("food", popOnly(300));
    expect(single).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
    expect(triple).toBeCloseTo(single * 3, 10);
  });

  it("clamps negative population and skilled counts to zero", () => {
    expect(consumptionRate("food", popOnly(0))).toBe(0);
    expect(consumptionRate("food", popOnly(-100))).toBe(0);
    expect(
      consumptionRate("food", { population: 100, technicians: -5, engineers: -5 }),
    ).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
  });

  it("returns 0 for unknown goods", () => {
    expect(consumptionRate("not_a_good", { population: 1000, technicians: 100, engineers: 50 })).toBe(0);
  });

  it("technicians add their basket on top of the baseline", () => {
    const base = consumptionRate("consumer_goods", popOnly(1000));
    const withTech = consumptionRate("consumer_goods", { population: 1000, technicians: 100, engineers: 0 });
    expect(withTech).toBeCloseTo(base + SKILL1_CONSUMPTION.consumer_goods * 100, 10);
  });

  it("engineers add luxuries demand; technicians do not", () => {
    const base = consumptionRate("luxuries", popOnly(1000));
    const withTech = consumptionRate("luxuries", { population: 1000, technicians: 200, engineers: 0 });
    const withEng = consumptionRate("luxuries", { population: 1000, technicians: 0, engineers: 40 });
    expect(withTech).toBeCloseTo(base, 10);
    expect(withEng).toBeCloseTo(base + SKILL2_CONSUMPTION.luxuries * 40, 10);
  });

  it("non-basket goods ignore skilled work entirely", () => {
    const base = consumptionRate("food", popOnly(1000));
    const skilled = consumptionRate("food", { population: 1000, technicians: 200, engineers: 40 });
    expect(skilled).toBeCloseTo(base, 10);
  });
});

describe("consumptionBreakdown", () => {
  it("terms sum to consumptionRate for a basket good with a mixed basis", () => {
    const basis: CivilianDemandBasis = { population: 1000, technicians: 100, engineers: 40 };
    const breakdown = consumptionBreakdown("luxuries", basis);
    expect(breakdown.base + breakdown.technicians + breakdown.engineers).toBeCloseTo(
      consumptionRate("luxuries", basis),
      10,
    );
  });

  it("terms sum to consumptionRate for a non-basket good", () => {
    const basis: CivilianDemandBasis = { population: 1000, technicians: 100, engineers: 40 };
    const breakdown = consumptionBreakdown("food", basis);
    expect(breakdown.base + breakdown.technicians + breakdown.engineers).toBeCloseTo(
      consumptionRate("food", basis),
      10,
    );
    expect(breakdown.technicians).toBe(0);
    expect(breakdown.engineers).toBe(0);
  });

  it("splits each term correctly for a basket good", () => {
    const basis: CivilianDemandBasis = { population: 1000, technicians: 100, engineers: 40 };
    const breakdown = consumptionBreakdown("consumer_goods", basis);
    expect(breakdown.base).toBeCloseTo(GOOD_CONSUMPTION.consumer_goods * 1000, 10);
    expect(breakdown.technicians).toBeCloseTo(SKILL1_CONSUMPTION.consumer_goods * 100, 10);
    expect(breakdown.engineers).toBeCloseTo(SKILL2_CONSUMPTION.consumer_goods * 40, 10);
  });

  it("zero-skill basis yields zero technicians/engineers terms", () => {
    const breakdown = consumptionBreakdown("luxuries", popOnly(1000));
    expect(breakdown.technicians).toBe(0);
    expect(breakdown.engineers).toBe(0);
  });

  it("clamps negative population and skilled counts to zero, like consumptionRate", () => {
    const breakdown = consumptionBreakdown("consumer_goods", { population: -100, technicians: -5, engineers: -5 });
    expect(breakdown.base).toBe(0);
    expect(breakdown.technicians).toBe(0);
    expect(breakdown.engineers).toBe(0);
  });

  it("returns all-zero terms for unknown goods", () => {
    const breakdown = consumptionBreakdown("not_a_good", { population: 1000, technicians: 100, engineers: 50 });
    expect(breakdown).toEqual({ base: 0, technicians: 0, engineers: 0 });
  });
});
