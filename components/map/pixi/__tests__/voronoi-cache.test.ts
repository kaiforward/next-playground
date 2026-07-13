import { describe, it, expect } from "vitest";
import { buildSystemCells } from "@/components/map/pixi/voronoi-cache";
import type { AtlasSystem } from "@/lib/types/game";

const sys = (id: string, x: number, y: number): AtlasSystem => ({
  id, x, y, regionId: "r", factionId: "f", economyType: "agricultural", isGateway: false, developed: true,
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
});
