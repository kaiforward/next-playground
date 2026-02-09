import { describe, it, expect } from "vitest";
import {
  findShortestPath,
  findReachableSystems,
  validateRoute,
} from "../pathfinding";
import type { ConnectionInfo } from "../navigation";

/**
 * Build the full universe connection list from CONNECTIONS constants.
 * Bidirectional — each entry creates two ConnectionInfo objects.
 */
const CONNECTIONS_RAW: [string, string, number][] = [
  ["sol", "alpha_centauri", 10],
  ["sol", "kepler", 8],
  ["sol", "vega", 8],
  ["sol", "sirius", 10],
  ["sol", "arcturus", 7],
  ["alpha_centauri", "barnard", 6],
  ["alpha_centauri", "proxima", 9],
  ["kepler", "vega", 7],
  ["kepler", "barnard", 8],
  ["sirius", "proxima", 7],
  ["sirius", "arcturus", 8],
  ["arcturus", "vega", 6],
];

const connections: ConnectionInfo[] = CONNECTIONS_RAW.flatMap(
  ([from, to, cost]) => [
    { fromSystemId: from, toSystemId: to, fuelCost: cost },
    { fromSystemId: to, toSystemId: from, fuelCost: cost },
  ],
);

// ── findShortestPath ────────────────────────────────────────────

describe("findShortestPath", () => {
  it("finds a direct single-hop path", () => {
    const result = findShortestPath("sol", "alpha_centauri", connections);
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(["sol", "alpha_centauri"]);
    expect(result!.totalFuelCost).toBe(10);
    expect(result!.totalTravelDuration).toBe(5); // ceil(10/2)
  });

  it("finds optimal multi-hop path (sol → proxima via sirius)", () => {
    // Direct multi-hop options:
    // sol → alpha_centauri → proxima = 10 + 9 = 19 fuel
    // sol → sirius → proxima = 10 + 7 = 17 fuel (cheaper)
    const result = findShortestPath("sol", "proxima", connections);
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(["sol", "sirius", "proxima"]);
    expect(result!.totalFuelCost).toBe(17);
    // Duration: ceil(10/2) + ceil(7/2) = 5 + 4 = 9
    expect(result!.totalTravelDuration).toBe(9);
  });

  it("finds multi-hop path to barnard via cheapest route", () => {
    // sol → alpha_centauri → barnard = 10 + 6 = 16
    // sol → kepler → barnard = 8 + 8 = 16 (same cost, either is valid)
    const result = findShortestPath("sol", "barnard", connections);
    expect(result).not.toBeNull();
    expect(result!.totalFuelCost).toBe(16);
    expect(result!.path.length).toBe(3);
    expect(result!.path[0]).toBe("sol");
    expect(result!.path[2]).toBe("barnard");
  });

  it("returns null for same origin and destination", () => {
    const result = findShortestPath("sol", "sol", connections);
    expect(result).toBeNull();
  });

  it("returns null when no path exists (disconnected graph)", () => {
    const isolated: ConnectionInfo[] = [
      { fromSystemId: "a", toSystemId: "b", fuelCost: 5 },
      { fromSystemId: "b", toSystemId: "a", fuelCost: 5 },
    ];
    const result = findShortestPath("a", "sol", isolated);
    expect(result).toBeNull();
  });
});

// ── findReachableSystems ────────────────────────────────────────

describe("findReachableSystems", () => {
  it("with full fuel, all systems are reachable", () => {
    const reachable = findReachableSystems("sol", 100, connections);
    // 7 other systems in the universe
    expect(reachable.size).toBe(7);
    expect(reachable.has("alpha_centauri")).toBe(true);
    expect(reachable.has("proxima")).toBe(true);
    expect(reachable.has("barnard")).toBe(true);
  });

  it("with limited fuel, only nearby systems are reachable", () => {
    // Fuel = 10: can reach direct neighbors within 10 fuel
    // sol → kepler (8), sol → vega (8), sol → arcturus (7),
    // sol → alpha_centauri (10), sol → sirius (10)
    const reachable = findReachableSystems("sol", 10, connections);
    expect(reachable.has("kepler")).toBe(true);
    expect(reachable.has("vega")).toBe(true);
    expect(reachable.has("arcturus")).toBe(true);
    expect(reachable.has("alpha_centauri")).toBe(true);
    expect(reachable.has("sirius")).toBe(true);
    // Can't reach proxima (min 17) or barnard (min 16)
    expect(reachable.has("proxima")).toBe(false);
    expect(reachable.has("barnard")).toBe(false);
  });

  it("with very limited fuel, only cheapest neighbors reachable", () => {
    // Fuel = 7: sol → arcturus (7) only
    const reachable = findReachableSystems("sol", 7, connections);
    expect(reachable.has("arcturus")).toBe(true);
    // Arcturus → vega costs 6 more = 13 total, over budget
    expect(reachable.has("vega")).toBe(false);
    expect(reachable.has("kepler")).toBe(false);
  });

  it("with zero fuel, nothing is reachable", () => {
    const reachable = findReachableSystems("sol", 0, connections);
    expect(reachable.size).toBe(0);
  });

  it("includes correct path info for each reachable system", () => {
    const reachable = findReachableSystems("sol", 100, connections);
    const proxima = reachable.get("proxima")!;
    // Cheapest: sol → sirius → proxima = 17
    expect(proxima.fuelCost).toBe(17);
    expect(proxima.path[0]).toBe("sol");
    expect(proxima.path[proxima.path.length - 1]).toBe("proxima");
  });

  it("does not include origin in results", () => {
    const reachable = findReachableSystems("sol", 100, connections);
    expect(reachable.has("sol")).toBe(false);
  });
});

// ── validateRoute ───────────────────────────────────────────────

describe("validateRoute", () => {
  it("validates a single-hop route", () => {
    const result = validateRoute(["sol", "alpha_centauri"], connections, 50);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalFuelCost).toBe(10);
      expect(result.totalTravelDuration).toBe(5);
    }
  });

  it("validates a multi-hop route", () => {
    const result = validateRoute(
      ["sol", "sirius", "proxima"],
      connections,
      50,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalFuelCost).toBe(17);
      expect(result.totalTravelDuration).toBe(9); // 5 + 4
    }
  });

  it("fails when a connection is missing mid-route", () => {
    // sol → proxima has no direct connection
    const result = validateRoute(["sol", "proxima"], connections, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No connection from sol to proxima");
    }
  });

  it("fails with insufficient fuel for multi-hop", () => {
    // sol → sirius → proxima needs 17 fuel
    const result = validateRoute(
      ["sol", "sirius", "proxima"],
      connections,
      15,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not enough fuel");
    }
  });

  it("fails when route is too short", () => {
    const result = validateRoute(["sol"], connections, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("at least 2 systems");
    }
  });

  it("fails when route has duplicate consecutive systems", () => {
    const result = validateRoute(["sol", "sol", "kepler"], connections, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("duplicate consecutive");
    }
  });
});
