import { describe, it, expect } from "vitest";
import { consumptionRate } from "../physical-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";

describe("consumptionRate", () => {
  it("scales linearly with population", () => {
    const single = consumptionRate("food", 100);
    const triple = consumptionRate("food", 300);
    expect(triple).toBeCloseTo(single * 3, 10);
    expect(single).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
  });

  it("is zero at or below zero population", () => {
    expect(consumptionRate("food", 0)).toBe(0);
    expect(consumptionRate("food", -100)).toBe(0);
  });

  it("yields zero consumption for an unknown good", () => {
    expect(consumptionRate("not_a_good", 1000)).toBe(0);
  });
});
