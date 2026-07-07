import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getStaticTile } from "@/lib/services/static-tiles";
import { systemToTile, tileBounds, TILE_COLS, TILE_ROWS } from "@/lib/engine/tiles";
import type { World } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 33 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getStaticTile", () => {
  it("returns the systems inside the tile's mapSize-scaled bounds, id-sorted, with name + economy", () => {
    // A tile guaranteed to contain at least one system.
    const sample = world.systems[0];
    const { col, row } = systemToTile(sample.x, sample.y, world.meta.mapSize);
    const bounds = tileBounds(col, row, world.meta.mapSize);

    const expectedIds = world.systems
      .filter(
        (s) => s.x >= bounds.minX && s.x < bounds.maxX && s.y >= bounds.minY && s.y < bounds.maxY,
      )
      .map((s) => s.id)
      .sort((a, b) => a.localeCompare(b));

    const tile = getStaticTile(col, row);
    expect(tile.systems.map((s) => s.id)).toEqual(expectedIds);

    const entry = tile.systems.find((s) => s.id === sample.id)!;
    expect(entry.name).toBe(sample.name);
    expect(entry.economyType).toBe(sample.economyType);
  });

  it("partitions systems across tiles with no overlap and only real systems", () => {
    const validIds = new Set(world.systems.map((s) => s.id));
    const seen = new Set<string>();
    for (let col = 0; col < TILE_COLS; col++) {
      for (let row = 0; row < TILE_ROWS; row++) {
        for (const s of getStaticTile(col, row).systems) {
          expect(validIds.has(s.id)).toBe(true); // real system
          expect(seen.has(s.id)).toBe(false); // never in two tiles
          seen.add(s.id);
        }
      }
    }
  });

  it("excludes a system from a tile that doesn't contain it", () => {
    const sample = world.systems[0];
    const { col, row } = systemToTile(sample.x, sample.y, world.meta.mapSize);
    // The diagonally-opposite tile cannot contain the sample system.
    const otherCol = col === 0 ? TILE_COLS - 1 : 0;
    const otherRow = row === 0 ? TILE_ROWS - 1 : 0;
    const tile = getStaticTile(otherCol, otherRow);
    expect(tile.systems.some((s) => s.id === sample.id)).toBe(false);
  });
});
