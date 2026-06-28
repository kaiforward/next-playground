import { Container, Graphics } from "pixi.js";
import { cumulativeLengths, pointAtFractionInto, type Point } from "../flow-arc";
import { SIZES } from "../theme";

/** Gap (world units) between the arrowhead tip and the destination circle edge. */
const ARROW_TIP_GAP = 2;

/** Visual treatment for a flow edge's particles + optional decorations. */
export interface FlowEdgeStyle {
  /** Particle radius in world space. */
  particleRadius: number;
  /** Particle alpha (multiplied with LOD/layer alpha at the layer). */
  particleAlpha: number;
  /** Pixels per second a particle travels along the edge. */
  particleSpeed: number;
  /** Radius of a faint halo behind each particle; 0 = no glow. */
  glowBlur: number;
  /** Draw a faint static line under the particles (for off-lane arcs). */
  drawPath: boolean;
  /** Alpha of the static path line when `drawPath` is set. */
  pathAlpha: number;
  /** Draw a static arrowhead at the destination end. */
  arrowhead: boolean;
  /** Arrowhead size in world space when `arrowhead` is set. */
  arrowSize: number;
}

interface Particle {
  gfx: Graphics;
  /** Offset along the edge, 0..1 (arc-length parameter). */
  offset: number;
  /** Fraction of the edge advanced per millisecond. */
  speed: number;
}

/**
 * Per-edge particle emitter for a flow overlay. Owns one Pixi `Container` with N
 * child particles flowing along a baked **polyline** path (straight 2-point for
 * market diffusion, sampled arc for directed logistics). Pure presentation — no
 * awareness of the good beyond the colour it was handed.
 *
 * Lifecycle: create once per active edge, `update(dtMs)` each frame, `destroy()`
 * when it leaves the flow set. Path is baked at construction; if an endpoint
 * moves we destroy + recreate.
 */
export class TradeFlowEdge {
  readonly container = new Container();
  /** Particle count baked into this edge — used by the layer's diff. */
  readonly particleCount: number;
  readonly fromSystemId: string;
  readonly toSystemId: string;
  readonly dominantGoodId: string;
  private particles: Particle[] = [];
  private path: Point[];
  private cum: number[];
  private total: number;
  /** Polyline AABB, baked once with the path; frustum culling reads it each frame. */
  private readonly bboxMinX: number;
  private readonly bboxMinY: number;
  private readonly bboxMaxX: number;
  private readonly bboxMaxY: number;
  /** Reused per-particle position so the per-frame loop allocates nothing. */
  private readonly scratch: Point = { x: 0, y: 0 };

  constructor(
    path: Point[],
    particleCount: number,
    color: number,
    style: FlowEdgeStyle,
    identity: { fromSystemId: string; toSystemId: string; dominantGoodId: string },
  ) {
    this.particleCount = particleCount;
    this.fromSystemId = identity.fromSystemId;
    this.toSystemId = identity.toSystemId;
    this.dominantGoodId = identity.dominantGoodId;
    this.path = path;
    const { cum, total } = cumulativeLengths(path);
    this.cum = cum;
    this.total = total;

    // Bake the polyline AABB once — frustum culling reads it every frame.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    this.bboxMinX = minX;
    this.bboxMinY = minY;
    this.bboxMaxX = maxX;
    this.bboxMaxY = maxY;

    // Faint static route line under the particles (off-lane arcs read better).
    if (style.drawPath && path.length >= 2 && total > 0) {
      const line = new Graphics();
      line.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) line.lineTo(path[i].x, path[i].y);
      line.stroke({ color, alpha: style.pathAlpha, width: style.particleRadius * 0.6 });
      this.container.addChild(line);
    }

    // Static arrowhead near the destination, oriented along the last segment.
    // Pulled back along the arrival tangent so the tip touches the destination
    // circle edge (core radius + gap) instead of sitting under the system glyph.
    if (style.arrowhead && path.length >= 2) {
      const a = path[path.length - 2];
      const b = path[path.length - 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen > 0) {
        const s = style.arrowSize;
        const ux = dx / segLen;
        const uy = dy / segLen;
        // Tip (local +s) should land at the circle edge: position back by radius + gap + s.
        const pullback = SIZES.systemCoreRadius + ARROW_TIP_GAP + s;
        const tri = new Graphics();
        tri.moveTo(s, 0);
        tri.lineTo(-s * 0.8, s * 0.7);
        tri.lineTo(-s * 0.8, -s * 0.7);
        tri.fill({ color, alpha: style.particleAlpha });
        tri.position.set(b.x - ux * pullback, b.y - uy * pullback);
        tri.rotation = Math.atan2(dy, dx);
        this.container.addChild(tri);
      }
    }

    const speedPerMs = total > 0 ? style.particleSpeed / total / 1000 : 0;
    for (let i = 0; i < particleCount; i++) {
      const gfx = new Graphics();
      gfx.circle(0, 0, style.particleRadius);
      gfx.fill({ color, alpha: style.particleAlpha });
      // Cheap glow: a larger, fainter halo behind the core dot (no Pixi filters).
      if (style.glowBlur > 0) {
        const halo = new Graphics();
        halo.circle(0, 0, style.particleRadius + style.glowBlur);
        halo.fill({ color, alpha: style.particleAlpha * 0.25 });
        gfx.addChildAt(halo, 0);
      }
      this.container.addChild(gfx);
      this.particles.push({
        gfx,
        offset: particleCount > 0 ? i / particleCount : 0,
        speed: speedPerMs,
      });
    }
  }

  /** Returns true if a frustum AABB overlaps this edge's baked polyline bbox. */
  intersects(minX: number, minY: number, maxX: number, maxY: number): boolean {
    return (
      this.bboxMaxX >= minX &&
      this.bboxMinX <= maxX &&
      this.bboxMaxY >= minY &&
      this.bboxMinY <= maxY
    );
  }

  /** Advance particle offsets. Caller guarantees the edge is visible. */
  update(dtMs: number) {
    if (this.total === 0) return;
    for (const p of this.particles) {
      p.offset = (p.offset + p.speed * dtMs) % 1;
      pointAtFractionInto(this.path, this.cum, this.total, p.offset, this.scratch);
      p.gfx.position.set(this.scratch.x, this.scratch.y);
    }
  }

  destroy() {
    this.particles = [];
    this.container.destroy({ children: true });
  }
}
