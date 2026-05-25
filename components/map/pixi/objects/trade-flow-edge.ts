import { Container, Graphics } from "pixi.js";
import { TRADE_FLOW } from "../theme";

interface Particle {
  gfx: Graphics;
  /** Offset along the edge, 0..1. */
  offset: number;
  /** Fraction of the edge advanced per millisecond. */
  speed: number;
}

/**
 * Per-edge particle emitter for the trade-flow overlay.
 *
 * Owns one Pixi `Container` plus N child `Graphics` particles flowing from
 * `from` to `to` (the net flow direction supplied by the service). Pure
 * presentation — no awareness of which good is moving beyond the colour it
 * was given at construction time.
 *
 * Lifecycle: create once per active edge, call `update(dtMs)` each frame,
 * `destroy()` when the edge disappears from the flow set. Endpoint positions
 * are baked at construction; if a system ever moves we'd destroy + recreate.
 */
export class TradeFlowEdge {
  readonly container = new Container();
  /** Number of particles baked into this edge — used by the layer's diff. */
  readonly particleCount: number;
  /**
   * Identity fields used by the layer to detect when an edge needs to be
   * recreated (direction flip or dominant-good swap won't change the key,
   * but the visual baked here would go stale).
   */
  readonly fromSystemId: string;
  readonly toSystemId: string;
  readonly dominantGoodId: string;
  private particles: Particle[] = [];
  private fromX: number;
  private fromY: number;
  private toX: number;
  private toY: number;
  private edgeLengthSq: number;

  constructor(
    from: { x: number; y: number },
    to: { x: number; y: number },
    particleCount: number,
    color: number,
    identity: {
      fromSystemId: string;
      toSystemId: string;
      dominantGoodId: string;
    },
  ) {
    this.particleCount = particleCount;
    this.fromSystemId = identity.fromSystemId;
    this.toSystemId = identity.toSystemId;
    this.dominantGoodId = identity.dominantGoodId;
    this.fromX = from.x;
    this.fromY = from.y;
    this.toX = to.x;
    this.toY = to.y;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    this.edgeLengthSq = dx * dx + dy * dy;

    // Speed expressed as fraction-of-edge per ms so particles take the same
    // wall-clock time to traverse short and long edges. Skip if endpoints
    // coincide to avoid divide-by-zero.
    const speedPerMs = length > 0 ? TRADE_FLOW.particleSpeed / length / 1000 : 0;

    for (let i = 0; i < particleCount; i++) {
      const gfx = new Graphics();
      gfx.circle(0, 0, TRADE_FLOW.particleRadius);
      gfx.fill({ color, alpha: TRADE_FLOW.particleAlpha });
      this.container.addChild(gfx);
      this.particles.push({
        gfx,
        // Evenly distribute initial offsets so a fresh edge doesn't start with
        // all particles bunched at the source.
        offset: particleCount > 0 ? i / particleCount : 0,
        speed: speedPerMs,
      });
    }
  }

  /** Returns true if a frustum AABB overlaps this edge's bounding box. */
  intersects(minX: number, minY: number, maxX: number, maxY: number): boolean {
    const segMinX = Math.min(this.fromX, this.toX);
    const segMaxX = Math.max(this.fromX, this.toX);
    const segMinY = Math.min(this.fromY, this.toY);
    const segMaxY = Math.max(this.fromY, this.toY);
    return (
      segMaxX >= minX &&
      segMinX <= maxX &&
      segMaxY >= minY &&
      segMinY <= maxY
    );
  }

  /** Advance particle offsets. Caller guarantees the edge is visible. */
  update(dtMs: number) {
    if (this.edgeLengthSq === 0) return;
    for (const p of this.particles) {
      p.offset = (p.offset + p.speed * dtMs) % 1;
      const x = this.fromX + (this.toX - this.fromX) * p.offset;
      const y = this.fromY + (this.toY - this.fromY) * p.offset;
      p.gfx.position.set(x, y);
    }
  }

  destroy() {
    this.particles = [];
    this.container.destroy({ children: true });
  }
}
