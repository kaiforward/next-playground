import { describe, it, expect } from "vitest";
import { validateNavigation } from "../navigation";

describe("validateNavigation", () => {
  const connections = [
    { fromSystemId: "sol", toSystemId: "alpha_centauri", fuelCost: 10 },
    { fromSystemId: "sol", toSystemId: "kepler", fuelCost: 8 },
    { fromSystemId: "alpha_centauri", toSystemId: "sol", fuelCost: 10 },
    { fromSystemId: "kepler", toSystemId: "sol", fuelCost: 8 },
  ];

  it("succeeds with a valid connection and enough fuel", () => {
    const result = validateNavigation({
      currentSystemId: "sol",
      targetSystemId: "alpha_centauri",
      connections,
      currentFuel: 50,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fuelCost).toBe(10);
    }
  });

  it("succeeds with exact fuel needed", () => {
    const result = validateNavigation({
      currentSystemId: "sol",
      targetSystemId: "kepler",
      connections,
      currentFuel: 8,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fuelCost).toBe(8);
    }
  });

  it("fails when no connection exists", () => {
    const result = validateNavigation({
      currentSystemId: "sol",
      targetSystemId: "proxima", // No direct connection from sol
      connections,
      currentFuel: 50,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No direct connection");
    }
  });

  it("fails with insufficient fuel", () => {
    const result = validateNavigation({
      currentSystemId: "sol",
      targetSystemId: "alpha_centauri",
      connections,
      currentFuel: 5, // Need 10
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not enough fuel");
    }
  });

  it("fails when trying to navigate to current system", () => {
    const result = validateNavigation({
      currentSystemId: "sol",
      targetSystemId: "sol",
      connections,
      currentFuel: 50,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Already in that system");
    }
  });
});
