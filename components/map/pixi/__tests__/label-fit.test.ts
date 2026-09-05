import { describe, it, expect } from "vitest";
import { labelFitsCell } from "../label-fit";
import type { MultiPolygon } from "../territory-utils";

/** A square cell of the given half-side, centred on the origin. */
function squareCell(halfSide: number): MultiPolygon {
  return [
    [
      [
        [-halfSide, -halfSide],
        [halfSide, -halfSide],
        [halfSide, halfSide],
        [-halfSide, halfSide],
        [-halfSide, -halfSide],
      ],
    ],
  ];
}

describe("labelFitsCell", () => {
  it("a box centred in a large cell fits", () => {
    const cell = squareCell(100);
    expect(labelFitsCell({ x: 0, y: 0 }, 10, 5, cell)).toBe(true);
  });

  it("the same box in a cell narrower than the box does not fit", () => {
    const cell = squareCell(5); // half-side 5 < box half-width 10
    expect(labelFitsCell({ x: 0, y: 0 }, 10, 5, cell)).toBe(false);
  });

  it("a box that fits at zoom 2 fails at zoom 0.9 for the same cell (world-unit half extents grow as zoom falls)", () => {
    const cell = squareCell(20);
    const pxHalfW = 30;
    const pxHalfH = 10;

    const halfExtentsAt = (zoom: number) => ({ halfW: pxHalfW / zoom, halfH: pxHalfH / zoom });

    const atZoom2 = halfExtentsAt(2); // { 15, 5 } — fits inside the 20-half-side cell
    expect(labelFitsCell({ x: 0, y: 0 }, atZoom2.halfW, atZoom2.halfH, cell)).toBe(true);

    const atZoom09 = halfExtentsAt(0.9); // { ~33.3, ~11.1 } — halfW alone exceeds the cell
    expect(labelFitsCell({ x: 0, y: 0 }, atZoom09.halfW, atZoom09.halfH, cell)).toBe(false);
  });

  it("a corner exactly on the cell edge counts as inside (boundary inclusive)", () => {
    const cell = squareCell(10);
    // Box half-extents exactly match the cell's half-side — every corner lands precisely on an edge.
    expect(labelFitsCell({ x: 0, y: 0 }, 10, 10, cell)).toBe(true);
  });

  it("vacuity: a fit function returning true unconditionally fails the narrow-cell case", () => {
    const alwaysFits = () => true;
    const cell = squareCell(5);
    expect(alwaysFits()).toBe(true); // sanity: the stub itself reports "fits"
    expect(labelFitsCell({ x: 0, y: 0 }, 10, 5, cell)).toBe(false); // the real function disagrees
  });
});
