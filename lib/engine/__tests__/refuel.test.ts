import { describe, it, expect } from "vitest";
import { validateRefuel } from "../refuel";

describe("validateRefuel", () => {
  const baseParams = {
    fuel: 50,
    maxFuel: 100,
    shipStatus: "docked" as const,
    amount: 30,
    playerCredits: 1000,
    costPerUnit: 2,
  };

  it("succeeds with valid params", () => {
    const result = validateRefuel(baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fuelToAdd).toBe(30);
      expect(result.data.totalCost).toBe(60); // 30 * 2
    }
  });

  it("succeeds when filling tank completely", () => {
    const result = validateRefuel({ ...baseParams, amount: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fuelToAdd).toBe(50);
      expect(result.data.totalCost).toBe(100);
    }
  });

  it("fails when ship is in transit", () => {
    const result = validateRefuel({ ...baseParams, shipStatus: "in_transit" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ship must be docked to refuel");
    }
  });

  it("fails when amount exceeds fuel needed", () => {
    const result = validateRefuel({ ...baseParams, amount: 60 }); // only needs 50
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Tank only needs 50 more");
    }
  });

  it("fails when player cannot afford", () => {
    const result = validateRefuel({ ...baseParams, playerCredits: 10, amount: 30 }); // costs 60
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not enough credits");
    }
  });

  it("fails with zero amount", () => {
    const result = validateRefuel({ ...baseParams, amount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Amount must be a positive integer");
    }
  });

  it("fails with negative amount", () => {
    const result = validateRefuel({ ...baseParams, amount: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Amount must be a positive integer");
    }
  });

  it("fails with non-integer amount", () => {
    const result = validateRefuel({ ...baseParams, amount: 5.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Amount must be a positive integer");
    }
  });

  it("handles tank already full (amount > 0 but fuelNeeded = 0)", () => {
    const result = validateRefuel({ ...baseParams, fuel: 100, amount: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Tank only needs 0 more");
    }
  });
});
