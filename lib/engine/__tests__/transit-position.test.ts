import { describe, it, expect } from "vitest";
import {
  reconstructTransitPath,
  interpolateTransit,
  clusterMarkers,
} from "@/lib/engine/transit-position";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { REFERENCE_SPEED } from "@/lib/constants/ships";

// A -- B -- C chain; fuelCost 2 each => 1 tick/hop at reference speed.
const chain: ConnectionInfo[] = [
  { fromSystemId: "A", toSystemId: "B", fuelCost: 2 },
  { fromSystemId: "B", toSystemId: "A", fuelCost: 2 },
  { fromSystemId: "B", toSystemId: "C", fuelCost: 2 },
  { fromSystemId: "C", toSystemId: "B", fuelCost: 2 },
];

const positions = new Map([
  ["A", { x: 0, y: 0 }],
  ["B", { x: 100, y: 0 }],
  ["C", { x: 200, y: 0 }],
]);

describe("reconstructTransitPath", () => {
  it("annotates each node with cumulative duration", () => {
    const path = reconstructTransitPath("A", "C", chain, REFERENCE_SPEED);
    expect(path.straightLine).toBe(false);
    expect(path.nodes.map((n) => n.systemId)).toEqual(["A", "B", "C"]);
    expect(path.nodes.map((n) => n.cumulativeDuration)).toEqual([0, 1, 2]);
    expect(path.totalDuration).toBe(2);
  });

  it("falls back to a straight 2-node line when disconnected", () => {
    const path = reconstructTransitPath("A", "Z", chain, REFERENCE_SPEED);
    expect(path.straightLine).toBe(true);
    expect(path.nodes.map((n) => n.systemId)).toEqual(["A", "Z"]);
    expect(path.totalDuration).toBe(1);
  });
});

describe("interpolateTransit", () => {
  const path = reconstructTransitPath("A", "C", chain, REFERENCE_SPEED);

  it("places the marker at the origin at progress 0", () => {
    expect(interpolateTransit(path, positions, 0)).toEqual({
      x: 0, y: 0, angleRad: 0, segmentIndex: 0,
    });
  });

  it("places the marker at the destination at progress 1", () => {
    const p = interpolateTransit(path, positions, 1)!;
    expect(p.x).toBeCloseTo(200);
    expect(p.segmentIndex).toBe(1);
  });

  it("places the marker mid-second-segment at progress 0.75", () => {
    const p = interpolateTransit(path, positions, 0.75)!;
    expect(p.x).toBeCloseTo(150);
    expect(p.segmentIndex).toBe(1);
  });

  it("clamps progress outside [0,1]", () => {
    expect(interpolateTransit(path, positions, 5)!.x).toBeCloseTo(200);
    expect(interpolateTransit(path, positions, -1)!.x).toBeCloseTo(0);
  });

  it("returns null when a path system has no position", () => {
    expect(interpolateTransit(path, new Map([["A", { x: 0, y: 0 }]]), 0.75)).toBeNull();
  });
});

describe("clusterMarkers", () => {
  it("groups markers within the threshold and keeps far ones separate, order-stable", () => {
    const clusters = clusterMarkers(
      [
        { id: "1", x: 0, y: 0, item: "a" },
        { id: "2", x: 5, y: 0, item: "b" },
        { id: "3", x: 100, y: 0, item: "c" },
      ],
      10,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].items).toEqual(["a", "b"]);
    expect(clusters[1].items).toEqual(["c"]);
  });
});
