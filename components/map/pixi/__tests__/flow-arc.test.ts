import { describe, it, expect } from "vitest";
import {
  arcPolyline,
  cumulativeLengths,
  pointAtFraction,
  pointAtFractionInto,
  type Point,
} from "@/components/map/pixi/flow-arc";

describe("arcPolyline", () => {
  it("returns segments + 1 points", () => {
    const pts = arcPolyline({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 1000, 24);
    expect(pts).toHaveLength(25);
  });

  it("starts at from and ends at to", () => {
    const pts = arcPolyline({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 1000, 24);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it("bows to the left of the from→to vector", () => {
    // Travelling +x; left is -y. Midpoint should sit at negative y.
    const pts = arcPolyline({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.2, 1000, 24);
    const mid = pts[12];
    expect(mid.y).toBeLessThan(0);
  });

  it("clamps bow to maxBow", () => {
    const big = arcPolyline({ x: 0, y: 0 }, { x: 10000, y: 0 }, 0.2, 50, 24);
    const mid = big[12];
    // bow ~ maxBow (50) at the apex of a quadratic = control*0.5 offset.
    expect(Math.abs(mid.y)).toBeLessThanOrEqual(50);
  });

  it("degenerates to a straight 2-point path when endpoints coincide", () => {
    const pts = arcPolyline({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.2, 1000, 24);
    expect(pts).toEqual([{ x: 5, y: 5 }, { x: 5, y: 5 }]);
  });
});

describe("cumulativeLengths / pointAtFraction", () => {
  it("produces a monotonic cumulative array", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const { cum, total } = cumulativeLengths(pts);
    expect(cum).toEqual([0, 3, 7]);
    expect(total).toBe(7);
  });

  it("samples endpoints and the arc-length midpoint", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const { cum, total } = cumulativeLengths(pts);
    expect(pointAtFraction(pts, cum, total, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(pts, cum, total, 1)).toEqual({ x: 10, y: 0 });
    expect(pointAtFraction(pts, cum, total, 0.5)).toEqual({ x: 5, y: 0 });
  });

  it("interpolates within a later segment of a multi-point polyline", () => {
    // L-shaped path: 3 units right, then 4 units up. total = 7.
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const { cum, total } = cumulativeLengths(pts);
    // u = 5/7 → arc-length 5 → 2 units up the vertical second segment.
    const p = pointAtFraction(pts, cum, total, 5 / 7);
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(2);
  });

  it("returns the first point when total arc-length is zero", () => {
    const pts = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
    const { cum, total } = cumulativeLengths(pts);
    expect(total).toBe(0);
    expect(pointAtFraction(pts, cum, total, 0.5)).toEqual({ x: 5, y: 5 });
  });

  it("pointAtFractionInto writes into the supplied point without allocating a new one", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const { cum, total } = cumulativeLengths(pts);
    const out: Point = { x: -1, y: -1 };
    pointAtFractionInto(pts, cum, total, 5 / 7, out);
    expect(out.x).toBeCloseTo(3);
    expect(out.y).toBeCloseTo(2);
  });
});
