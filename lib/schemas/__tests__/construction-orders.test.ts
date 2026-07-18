import { describe, it, expect } from "vitest";
import { orderBuildSchema, automationSchema } from "@/lib/schemas/construction-orders";

describe("construction order schemas", () => {
  it("accepts a valid build order and rejects non-positive / fractional / huge levels", () => {
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 2 }).success).toBe(true);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 0 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 1.5 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 101 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "", levels: 1 }).success).toBe(false);
  });

  it("requires both automation switches as booleans", () => {
    expect(automationSchema.safeParse({ build: true, colonisation: false }).success).toBe(true);
    expect(automationSchema.safeParse({ build: true }).success).toBe(false);
    expect(automationSchema.safeParse({ build: "yes", colonisation: false }).success).toBe(false);
  });
});
