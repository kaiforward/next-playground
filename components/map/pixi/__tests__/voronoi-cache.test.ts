import { describe, it, expect } from "vitest";
import { buildSystemCells } from "@/components/map/pixi/voronoi-cache";
import type { AtlasSystem } from "@/lib/types/game";

const sys = (id: string, x: number, y: number): AtlasSystem => ({
  id, x, y, regionId: "r", factionId: "f", economyType: "agricultural", isGateway: false, developed: true, sunClass: "yellow",
});

describe("buildSystemCells", () => {
  const MAP = 1000;
  const systems = [sys("a", 250, 250), sys("b", 750, 250), sys("c", 250, 750), sys("d", 750, 750)];
  const cells = buildSystemCells(systems, MAP);

  it("produces one cell per system", () => {
    expect(cells.cellsBySystemId.size).toBe(4);
    for (const s of systems) expect(cells.cellsBySystemId.has(s.id)).toBe(true);
  });
  it("findSystemAt returns the id of the nearest site (the containing Voronoi cell)", () => {
    expect(cells.findSystemAt(260, 260)).toBe("a");
    expect(cells.findSystemAt(740, 760)).toBe("d");
  });
  it("findSystemAt returns null outside the map extent", () => {
    expect(cells.findSystemAt(-10, 500)).toBeNull();
    expect(cells.findSystemAt(500, MAP + 10)).toBeNull();
  });
  it("findSystemAt resolves points on the inclusive extent edge (0 / mapSize)", () => {
    expect(cells.findSystemAt(0, 0)).not.toBeNull();
    expect(cells.findSystemAt(MAP, MAP)).not.toBeNull();
  });
  it("centroidBySystemId records each system's own position", () => {
    expect(cells.centroidBySystemId.get("a")).toEqual({ x: 250, y: 250 });
    expect(cells.centroidBySystemId.get("d")).toEqual({ x: 750, y: 750 });
  });
  it("exposes the systems it was built from, so consumers need no second copy", () => {
    expect(cells.systems).toBe(systems);
  });
});

describe("buildSystemCells — groupBy is the only territory-union path", () => {
  const MAP = 1000;
  // Two systems per region, arranged so each region's pair is adjacent and unions into one shape.
  const systems: AtlasSystem[] = [
    { ...sys("a", 200, 300), regionId: "north", factionId: "red" },
    { ...sys("b", 800, 300), regionId: "north", factionId: "blue" },
    { ...sys("c", 200, 700), regionId: "south", factionId: "red" },
    { ...sys("d", 800, 700), regionId: "south", factionId: null },
  ];
  const cells = buildSystemCells(systems, MAP);

  it("unions the cells of each group under its key", () => {
    const byRegion = cells.groupBy((s) => s.regionId);
    expect([...byRegion.keys()].sort()).toEqual(["north", "south"]);
    // The two north cells are adjacent, so they merge into one polygon spanning the full width —
    // a group that lost a member would cover only its own half.
    expect(byRegion.get("north")?.length).toBe(1);
    const xs = (byRegion.get("north") ?? []).flat(2).map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThan(100);
    expect(Math.max(...xs)).toBeGreaterThan(900);
  });

  it("drops a system from every group when its key is null", () => {
    const byFaction = cells.groupBy((s) => s.factionId);
    expect([...byFaction.keys()].sort()).toEqual(["blue", "red"]);
    // "d" holds the bottom-right quadrant and has no faction, so no group reaches that corner…
    const verts = [...byFaction.values()].flat(3);
    expect(verts.some(([x, y]) => x > 900 && y > 900)).toBe(false);
    // …while "red" still spans both of its systems, top and bottom.
    const redYs = (byFaction.get("red") ?? []).flat(2).map(([, y]) => y);
    expect(Math.min(...redYs)).toBeLessThan(100);
    expect(Math.max(...redYs)).toBeGreaterThan(900);
  });

  it("gives every grouping the same per-system geometry as cellsBySystemId", () => {
    // Grouping by id must reproduce the eagerly-built cell map — the two share one clipped-cell set,
    // so a divergence means a grouping recomputed geometry of its own.
    const byId = cells.groupBy((s) => s.id);
    expect(byId.size).toBe(systems.length);
    for (const s of systems) {
      expect(byId.get(s.id)).toBeDefined();
      expect(JSON.stringify(byId.get(s.id))).toBe(JSON.stringify(cells.cellsBySystemId.get(s.id)));
    }
  });
});

describe("buildSystemCells — trimmed edge regions are not clickable", () => {
  const MAP = 1000;
  // Three systems clustered near the top-left; the rest of the 1000×1000 box is empty space the
  // Voronoi would assign to a nearest site but the disc-clip visually trims away.
  const systems = [sys("a", 100, 100), sys("b", 160, 100), sys("c", 130, 150)];
  const cells = buildSystemCells(systems, MAP);

  it("returns the system for a click within its (clipped) cell", () => {
    expect(cells.findSystemAt(105, 105)).toBe("a");
    expect(cells.findSystemAt(158, 102)).toBe("b");
  });
  it("returns null for a click in a trimmed-away region (inside the extent, far from every site)", () => {
    // Inside the map box but far beyond the disc-clip radius of the clustered sites — visually empty,
    // so it must read as an empty click even though delaunay.find still names a nearest site.
    expect(cells.findSystemAt(700, 700)).toBeNull();
  });
});
