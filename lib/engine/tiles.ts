/**
 * Pure tile grid math for the scalable map system.
 * No DB dependency — all functions are deterministic and unit-testable.
 *
 * The map (7000×7000 world units) is divided into a fixed grid of tiles.
 * Grid dimensions target ~40 systems per tile at 10K systems scale.
 */

import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import type { ViewportBounds } from "@/lib/types/game";

// ── Constants ────────────────────────────────────────────────────

/** Number of tile columns across the map. */
export const TILE_COLS = 16;

/** Number of tile rows across the map. */
export const TILE_ROWS = 16;

/** Width of a single tile in world units. */
export const TILE_WIDTH = UNIVERSE_GEN.MAP_SIZE / TILE_COLS;

/** Height of a single tile in world units. */
export const TILE_HEIGHT = UNIVERSE_GEN.MAP_SIZE / TILE_ROWS;

// ── Types ────────────────────────────────────────────────────────

export interface TileCoord {
  col: number;
  row: number;
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Which tile a system belongs to, given its world-space coordinates.
 * Clamps to valid grid range — coordinates outside the map snap to edge tiles.
 */
export function systemToTile(x: number, y: number): TileCoord {
  const col = Math.min(Math.max(Math.floor(x / TILE_WIDTH), 0), TILE_COLS - 1);
  const row = Math.min(Math.max(Math.floor(y / TILE_HEIGHT), 0), TILE_ROWS - 1);
  return { col, row };
}

/**
 * World-space bounding box for a given tile.
 */
export function tileBounds(col: number, row: number): ViewportBounds {
  return {
    minX: col * TILE_WIDTH,
    minY: row * TILE_HEIGHT,
    maxX: (col + 1) * TILE_WIDTH,
    maxY: (row + 1) * TILE_HEIGHT,
  };
}

/**
 * Which tiles overlap a world-space frustum (camera bounding box).
 * Returns all tiles whose interior intersects the frustum, clamped to the grid.
 * Uses half-open [min, max) convention — a frustum edge exactly on a tile
 * boundary does not include the next tile (consistent with systemToTile).
 */
export function frustumToTiles(bounds: ViewportBounds): TileCoord[] {
  const minCol = Math.min(Math.max(Math.floor(bounds.minX / TILE_WIDTH), 0), TILE_COLS - 1);
  const maxCol = Math.min(Math.max(Math.ceil(bounds.maxX / TILE_WIDTH) - 1, 0), TILE_COLS - 1);
  const minRow = Math.min(Math.max(Math.floor(bounds.minY / TILE_HEIGHT), 0), TILE_ROWS - 1);
  const maxRow = Math.min(Math.max(Math.ceil(bounds.maxY / TILE_HEIGHT) - 1, 0), TILE_ROWS - 1);

  const tiles: TileCoord[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      tiles.push({ col, row });
    }
  }
  return tiles;
}
