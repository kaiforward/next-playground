import type { MultiPolygon } from "./territory-utils";

/** Standard even-odd ray-casting point-in-ring test. */
function pointInRing(ring: readonly [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * The faction whose union contains (x, y), or null. A point is inside a faction when it lies in a
 * polygon's exterior ring (poly[0]) and NOT in any of that polygon's holes (poly[1..]). Faction unions
 * don't overlap, so the first containing hit wins.
 */
export function findFactionAt(unions: Map<string, MultiPolygon>, x: number, y: number): string | null {
  for (const [factionId, multiPoly] of unions) {
    for (const poly of multiPoly) {
      const exterior = poly[0];
      if (!exterior || exterior.length < 3) continue;
      if (!pointInRing(exterior, x, y)) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(poly[h], x, y)) { inHole = true; break; }
      }
      if (!inHole) return factionId;
    }
  }
  return null;
}
