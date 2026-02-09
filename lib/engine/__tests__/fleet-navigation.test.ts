import { describe, it, expect } from "vitest";
import { validateFleetNavigation, validateFleetRouteNavigation } from "../navigation";

describe("validateFleetNavigation", () => {
  const connections = [
    { fromSystemId: "sol", toSystemId: "alpha_centauri", fuelCost: 10 },
    { fromSystemId: "sol", toSystemId: "kepler", fuelCost: 8 },
    { fromSystemId: "alpha_centauri", toSystemId: "sol", fuelCost: 10 },
  ];

  const baseParams = {
    currentSystemId: "sol",
    targetSystemId: "alpha_centauri",
    connections,
    currentFuel: 50,
    shipStatus: "docked" as const,
    currentTick: 10,
  };

  it("succeeds when ship is docked with valid connection and fuel", () => {
    const result = validateFleetNavigation(baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fuelCost).toBe(10);
      expect(result.travelDuration).toBe(5); // ceil(10 / 2)
      expect(result.departureTick).toBe(10);
      expect(result.arrivalTick).toBe(15);
    }
  });

  it("fails when ship is in transit", () => {
    const result = validateFleetNavigation({
      ...baseParams,
      shipStatus: "in_transit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ship must be docked");
    }
  });

  it("calculates travel duration as ceil(fuelCost / 2)", () => {
    // fuelCost 8 → ceil(4) = 4
    const result = validateFleetNavigation({
      ...baseParams,
      targetSystemId: "kepler",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.travelDuration).toBe(4); // ceil(8 / 2)
    }
  });

  it("enforces minimum travel duration of 1", () => {
    // fuelCost 1 → ceil(0.5) = 1
    const result = validateFleetNavigation({
      ...baseParams,
      connections: [
        { fromSystemId: "sol", toSystemId: "alpha_centauri", fuelCost: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.travelDuration).toBe(1);
    }
  });

  it("sets departure tick to current tick", () => {
    const result = validateFleetNavigation({
      ...baseParams,
      currentTick: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.departureTick).toBe(42);
      expect(result.arrivalTick).toBe(47); // 42 + 5
    }
  });

  it("delegates connection check to base validateNavigation", () => {
    const result = validateFleetNavigation({
      ...baseParams,
      targetSystemId: "proxima",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No direct connection");
    }
  });

  it("delegates fuel check to base validateNavigation", () => {
    const result = validateFleetNavigation({
      ...baseParams,
      currentFuel: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not enough fuel");
    }
  });
});

// ── validateFleetRouteNavigation ────────────────────────────────

describe("validateFleetRouteNavigation", () => {
  const allConnections = [
    { fromSystemId: "sol", toSystemId: "alpha_centauri", fuelCost: 10 },
    { fromSystemId: "alpha_centauri", toSystemId: "sol", fuelCost: 10 },
    { fromSystemId: "sol", toSystemId: "sirius", fuelCost: 10 },
    { fromSystemId: "sirius", toSystemId: "sol", fuelCost: 10 },
    { fromSystemId: "sirius", toSystemId: "proxima", fuelCost: 7 },
    { fromSystemId: "proxima", toSystemId: "sirius", fuelCost: 7 },
    { fromSystemId: "alpha_centauri", toSystemId: "proxima", fuelCost: 9 },
    { fromSystemId: "proxima", toSystemId: "alpha_centauri", fuelCost: 9 },
  ];

  const baseParams = {
    route: ["sol", "sirius", "proxima"],
    connections: allConnections,
    currentFuel: 50,
    shipStatus: "docked" as const,
    currentTick: 10,
  };

  it("succeeds with a valid multi-hop route", () => {
    const result = validateFleetRouteNavigation(baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalFuelCost).toBe(17); // 10 + 7
      expect(result.totalTravelDuration).toBe(9); // ceil(10/2) + ceil(7/2) = 5 + 4
      expect(result.departureTick).toBe(10);
      expect(result.arrivalTick).toBe(19); // 10 + 9
      expect(result.destinationSystemId).toBe("proxima");
    }
  });

  it("succeeds with a single-hop route", () => {
    const result = validateFleetRouteNavigation({
      ...baseParams,
      route: ["sol", "sirius"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalFuelCost).toBe(10);
      expect(result.destinationSystemId).toBe("sirius");
    }
  });

  it("fails when ship is in transit", () => {
    const result = validateFleetRouteNavigation({
      ...baseParams,
      shipStatus: "in_transit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ship must be docked");
    }
  });

  it("fails when a connection is broken mid-route", () => {
    const result = validateFleetRouteNavigation({
      ...baseParams,
      route: ["sol", "proxima"], // No direct connection
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No connection");
    }
  });

  it("fails with insufficient fuel for the full route", () => {
    const result = validateFleetRouteNavigation({
      ...baseParams,
      currentFuel: 15, // Need 17
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not enough fuel");
    }
  });

  it("fails with a too-short route", () => {
    const result = validateFleetRouteNavigation({
      ...baseParams,
      route: ["sol"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("at least 2 systems");
    }
  });
});
