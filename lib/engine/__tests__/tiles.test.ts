import { describe, it, expect } from "vitest";
import {
  TILE_COLS,
  TILE_ROWS,
  TILE_WIDTH,
  TILE_HEIGHT,
  systemToTile,
  tileBounds,
  frustumToTiles,
} from "../tiles";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";

// ── Constants ────────────────────────────────────────────────────

describe("tile constants", () => {
  it("grid covers the full map", () => {
    expect(TILE_COLS * TILE_WIDTH).toBe(UNIVERSE_GEN.MAP_SIZE);
    expect(TILE_ROWS * TILE_HEIGHT).toBe(UNIVERSE_GEN.MAP_SIZE);
  });

  it("grid is 16×16", () => {
    expect(TILE_COLS).toBe(16);
    expect(TILE_ROWS).toBe(16);
  });

  it("each tile is 437.5 world units", () => {
    expect(TILE_WIDTH).toBe(UNIVERSE_GEN.MAP_SIZE / 16);
    expect(TILE_HEIGHT).toBe(UNIVERSE_GEN.MAP_SIZE / 16);
  });
});

// ── systemToTile ─────────────────────────────────────────────────

describe("systemToTile", () => {
  it("maps origin to tile (0, 0)", () => {
    expect(systemToTile(0, 0)).toEqual({ col: 0, row: 0 });
  });

  it("maps coordinates within the first tile", () => {
    expect(systemToTile(100, 200)).toEqual({ col: 0, row: 0 });
  });

  it("maps coordinates to the correct interior tile", () => {
    // x=2000 / 437.5 = 4.57 → col 4
    // y=3500 / 437.5 = 8.0  → row 8 (exact boundary → belongs to tile 8)
    expect(systemToTile(2000, 3500)).toEqual({ col: 4, row: 8 });
  });

  it("maps coordinates near max to the last tile", () => {
    expect(systemToTile(6999, 6999)).toEqual({ col: 15, row: 15 });
  });

  it("clamps coordinates at exact map size to last tile", () => {
    expect(systemToTile(UNIVERSE_GEN.MAP_SIZE, UNIVERSE_GEN.MAP_SIZE)).toEqual({
      col: 15,
      row: 15,
    });
  });

  it("clamps negative coordinates to tile (0, 0)", () => {
    expect(systemToTile(-100, -50)).toEqual({ col: 0, row: 0 });
  });

  it("clamps coordinates beyond map to last tile", () => {
    expect(systemToTile(10000, 8000)).toEqual({ col: 15, row: 15 });
  });

  it("handles exact tile boundary — belongs to next tile", () => {
    expect(systemToTile(TILE_WIDTH, 0)).toEqual({ col: 1, row: 0 });
  });
});

// ── tileBounds ───────────────────────────────────────────────────

describe("tileBounds", () => {
  it("returns origin bounds for tile (0, 0)", () => {
    expect(tileBounds(0, 0)).toEqual({
      minX: 0,
      minY: 0,
      maxX: TILE_WIDTH,
      maxY: TILE_HEIGHT,
    });
  });

  it("returns correct bounds for an interior tile", () => {
    const bounds = tileBounds(3, 7);
    expect(bounds).toEqual({
      minX: 3 * TILE_WIDTH,
      minY: 7 * TILE_HEIGHT,
      maxX: 4 * TILE_WIDTH,
      maxY: 8 * TILE_HEIGHT,
    });
  });

  it("returns bounds covering the far corner for last tile", () => {
    const bounds = tileBounds(15, 15);
    expect(bounds.maxX).toBe(UNIVERSE_GEN.MAP_SIZE);
    expect(bounds.maxY).toBe(UNIVERSE_GEN.MAP_SIZE);
  });

  it("tile bounds have consistent width and height", () => {
    for (let col = 0; col < TILE_COLS; col++) {
      for (let row = 0; row < TILE_ROWS; row++) {
        const b = tileBounds(col, row);
        expect(b.maxX - b.minX).toBeCloseTo(TILE_WIDTH);
        expect(b.maxY - b.minY).toBeCloseTo(TILE_HEIGHT);
      }
    }
  });
});

// ── frustumToTiles ───────────────────────────────────────────────

describe("frustumToTiles", () => {
  it("returns a single tile for a small frustum", () => {
    const tiles = frustumToTiles({ minX: 100, minY: 100, maxX: 200, maxY: 200 });
    expect(tiles).toEqual([{ col: 0, row: 0 }]);
  });

  it("returns multiple tiles when frustum spans a boundary", () => {
    // Spans from tile col 0 into tile col 1
    const tiles = frustumToTiles({
      minX: 400,
      minY: 100,
      maxX: 500,
      maxY: 200,
    });
    expect(tiles).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
  });

  it("returns a 2×2 grid for a frustum spanning two tiles in each axis", () => {
    const tiles = frustumToTiles({
      minX: 400,
      minY: 400,
      maxX: 500,
      maxY: 500,
    });
    expect(tiles).toHaveLength(4);
    expect(tiles).toContainEqual({ col: 0, row: 0 });
    expect(tiles).toContainEqual({ col: 1, row: 0 });
    expect(tiles).toContainEqual({ col: 0, row: 1 });
    expect(tiles).toContainEqual({ col: 1, row: 1 });
  });

  it("returns all tiles for a frustum covering the entire map", () => {
    // Use a maxX/maxY slightly past a tile boundary to enter the last tile
    const tiles = frustumToTiles({
      minX: 0,
      minY: 0,
      maxX: UNIVERSE_GEN.MAP_SIZE - 1,
      maxY: UNIVERSE_GEN.MAP_SIZE - 1,
    });
    expect(tiles).toHaveLength(TILE_COLS * TILE_ROWS);
  });

  it("clamps frustum that extends beyond map bounds", () => {
    const tiles = frustumToTiles({ minX: -500, minY: -500, maxX: 8000, maxY: 8000 });
    expect(tiles).toHaveLength(TILE_COLS * TILE_ROWS);
    expect(tiles[0]).toEqual({ col: 0, row: 0 });
    expect(tiles[tiles.length - 1]).toEqual({ col: 15, row: 15 });
  });

  it("excludes tiles when frustum edge sits exactly on tile boundary (half-open)", () => {
    // maxX = exactly TILE_WIDTH means the frustum stops at col 0's right edge
    // and does NOT enter col 1 (half-open convention)
    const tiles = frustumToTiles({
      minX: 0,
      minY: 0,
      maxX: TILE_WIDTH,
      maxY: TILE_HEIGHT,
    });
    expect(tiles).toEqual([{ col: 0, row: 0 }]);
  });

  it("includes next tile when frustum edge passes just beyond boundary", () => {
    const tiles = frustumToTiles({
      minX: 0,
      minY: 0,
      maxX: TILE_WIDTH + 0.001,
      maxY: TILE_HEIGHT + 0.001,
    });
    expect(tiles).toHaveLength(4);
    expect(tiles).toContainEqual({ col: 0, row: 0 });
    expect(tiles).toContainEqual({ col: 1, row: 0 });
    expect(tiles).toContainEqual({ col: 0, row: 1 });
    expect(tiles).toContainEqual({ col: 1, row: 1 });
  });

  it("returns tiles in row-major order", () => {
    // Use maxX/maxY slightly past the 2nd boundary to include tiles 0, 1, 2
    const tiles = frustumToTiles({
      minX: 0,
      minY: 0,
      maxX: TILE_WIDTH * 2 + 1,
      maxY: TILE_HEIGHT * 2 + 1,
    });
    expect(tiles).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 0, row: 2 },
      { col: 1, row: 2 },
      { col: 2, row: 2 },
    ]);
  });
});

// ── Round-trip consistency ────────────────────────────────────────

describe("round-trip: systemToTile → tileBounds", () => {
  it("system coordinates fall within the bounds of its tile", () => {
    const testPoints = [
      [0, 0],
      [100, 200],
      [3500, 3500],
      [6999, 6999],
      [TILE_WIDTH, 0],
      [0, TILE_HEIGHT],
      [TILE_WIDTH * 7.5, TILE_HEIGHT * 3.2],
    ] as const;

    for (const [x, y] of testPoints) {
      const tile = systemToTile(x, y);
      const bounds = tileBounds(tile.col, tile.row);
      expect(x).toBeGreaterThanOrEqual(bounds.minX);
      expect(x).toBeLessThan(bounds.maxX);
      expect(y).toBeGreaterThanOrEqual(bounds.minY);
      expect(y).toBeLessThan(bounds.maxY);
    }
  });

  it("frustumToTiles always includes the tile a point maps to", () => {
    const points = [
      [500, 500],
      [3500, 1200],
      [6800, 6800],
    ] as const;

    for (const [x, y] of points) {
      const tile = systemToTile(x, y);
      // Create a small frustum around the point
      const tiles = frustumToTiles({
        minX: x - 50,
        minY: y - 50,
        maxX: x + 50,
        maxY: y + 50,
      });
      expect(tiles).toContainEqual(tile);
    }
  });
});
