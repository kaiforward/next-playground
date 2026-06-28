import { describe, it, expect } from "vitest";
import {
  arcPolyline,
  cumulativeLengths,
  pointAtFraction,
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
});
