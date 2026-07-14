import { describe, it, expect } from "vitest";
import { findFactionAt } from "@/components/map/pixi/faction-hit-test";
import type { MultiPolygon } from "@/components/map/pixi/territory-utils";

/** Square ring from (x0,y0) to (x1,y1), closed (first vertex repeated at the end). */
function square(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

describe("findFactionAt (ray-casting point-in-union hit test)", () => {
  it("finds the faction whose union contains the point, or null in the gap / outside everything", () => {
    const unions = new Map<string, MultiPolygon>([
      ["a", [[square(0, 0, 100, 100)]]],
      ["b", [[square(200, 0, 300, 100)]]],
    ]);

    expect(findFactionAt(unions, 50, 50)).toBe("a");
    expect(findFactionAt(unions, 250, 50)).toBe("b");
    expect(findFactionAt(unions, 150, 50)).toBeNull(); // gap between the two squares
    expect(findFactionAt(unions, -10, -10)).toBeNull(); // outside everything
  });

  it("excludes points inside a polygon's hole while including points in the ring but outside the hole", () => {
    const outer = square(0, 0, 100, 100);
    const hole = square(40, 40, 60, 60);
    const unions = new Map<string, MultiPolygon>([
      ["c", [[outer, hole]]],
    ]);

    expect(findFactionAt(unions, 50, 50)).toBeNull(); // inside the hole
    expect(findFactionAt(unions, 10, 10)).toBe("c"); // inside the ring, outside the hole
  });

  it("matches a faction whose union has multiple disjoint pieces (each a separate polygon)", () => {
    // computeTerritoryPolygons can group a faction's non-adjacent systems into one MultiPolygon with
    // several disjoint exterior rings — so the hit-test must scan every polygon in the union, not just
    // the first. Here faction "d" owns two separate squares with a gap between them.
    const unions = new Map<string, MultiPolygon>([
      ["d", [[square(0, 0, 100, 100)], [square(200, 0, 300, 100)]]],
    ]);

    expect(findFactionAt(unions, 50, 50)).toBe("d"); // first piece
    expect(findFactionAt(unions, 250, 50)).toBe("d"); // second (disjoint) piece
    expect(findFactionAt(unions, 150, 50)).toBeNull(); // in the gap between d's two pieces
  });
});
