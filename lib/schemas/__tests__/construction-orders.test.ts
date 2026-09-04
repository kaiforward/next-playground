import { describe, it, expect } from "vitest";
import { orderBuildSchema, orderLaneUpgradeSchema, automationSchema } from "@/lib/schemas/construction-orders";

describe("construction order schemas", () => {
  it("accepts a valid build order and rejects non-positive / fractional / huge levels", () => {
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 2 }).success).toBe(true);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 0 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 1.5 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "housing", levels: 101 }).success).toBe(false);
    expect(orderBuildSchema.safeParse({ buildingType: "", levels: 1 }).success).toBe(false);
  });

  it("accepts a valid lane upgrade order and rejects non-positive / fractional / huge levels", () => {
    expect(orderLaneUpgradeSchema.safeParse({ laneKey: "a|b", levels: 2 }).success).toBe(true);
    expect(orderLaneUpgradeSchema.safeParse({ laneKey: "a|b", levels: 0 }).success).toBe(false);
    expect(orderLaneUpgradeSchema.safeParse({ laneKey: "a|b", levels: 1.5 }).success).toBe(false);
    expect(orderLaneUpgradeSchema.safeParse({ laneKey: "a|b", levels: 101 }).success).toBe(false);
    expect(orderLaneUpgradeSchema.safeParse({ laneKey: "", levels: 1 }).success).toBe(false);
  });

  it("requires all three automation switches as booleans", () => {
    expect(automationSchema.safeParse({ build: true, colonisation: false, lanes: true }).success).toBe(true);
    expect(automationSchema.safeParse({ build: true, colonisation: false }).success).toBe(false); // lanes missing
    expect(automationSchema.safeParse({ build: true, lanes: true }).success).toBe(false); // colonisation missing
    expect(automationSchema.safeParse({ build: "yes", colonisation: false, lanes: true }).success).toBe(false);
  });
});
