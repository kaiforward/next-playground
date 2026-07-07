/**
 * Pure tile grid math for the scalable map system.
 * No DB dependency — all functions are deterministic and unit-testable.
 *
 * The map (mapSize × mapSize world units, from the world's meta) is divided
 * into a fixed 16×16 grid of tiles; tile size scales with the generated map.
 */

import type { ViewportBounds } from "@/lib/types/game";

// ── Constants ────────────────────────────────────────────────────

/** Number of tile columns across the map. */
export const TILE_COLS = 16;

/** Number of tile rows across the map. */
export const TILE_ROWS = 16;

// ── Types ────────────────────────────────────────────────────────

export interface TileCoord {
  col: number;
  row: number;
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Which tile a system belongs to, given its world-space coordinates and the
 * world's map size. Clamps to valid grid range — coordinates outside the map
 * snap to edge tiles.
 */
export function systemToTile(x: number, y: number, mapSize: number): TileCoord {
  const tileWidth = mapSize / TILE_COLS;
  const tileHeight = mapSize / TILE_ROWS;
  const col = Math.min(Math.max(Math.floor(x / tileWidth), 0), TILE_COLS - 1);
  const row = Math.min(Math.max(Math.floor(y / tileHeight), 0), TILE_ROWS - 1);
  return { col, row };
}

/**
 * World-space bounding box for a given tile.
 */
export function tileBounds(col: number, row: number, mapSize: number): ViewportBounds {
  const tileWidth = mapSize / TILE_COLS;
  const tileHeight = mapSize / TILE_ROWS;
  return {
    minX: col * tileWidth,
    minY: row * tileHeight,
    maxX: (col + 1) * tileWidth,
    maxY: (row + 1) * tileHeight,
  };
}

/**
 * Which tiles overlap a world-space frustum (camera bounding box).
 * Returns all tiles whose interior intersects the frustum, clamped to the grid.
 * Uses half-open [min, max) convention — a frustum edge exactly on a tile
 * boundary does not include the next tile (consistent with systemToTile).
 */
export function frustumToTiles(bounds: ViewportBounds, mapSize: number): TileCoord[] {
  const tileWidth = mapSize / TILE_COLS;
  const tileHeight = mapSize / TILE_ROWS;
  const minCol = Math.min(Math.max(Math.floor(bounds.minX / tileWidth), 0), TILE_COLS - 1);
  const maxCol = Math.min(Math.max(Math.ceil(bounds.maxX / tileWidth) - 1, 0), TILE_COLS - 1);
  const minRow = Math.min(Math.max(Math.floor(bounds.minY / tileHeight), 0), TILE_ROWS - 1);
  const maxRow = Math.min(Math.max(Math.ceil(bounds.maxY / tileHeight) - 1, 0), TILE_ROWS - 1);

  const tiles: TileCoord[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      tiles.push({ col, row });
    }
  }
  return tiles;
}
