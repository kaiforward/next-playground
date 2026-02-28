import { Container, Graphics } from "pixi.js";
import type { ConnectionData, SystemNodeData } from "@/lib/hooks/use-map-data";
import { NAV_COLORS, ANIM } from "../theme";

interface RouteParticle {
  gfx: Graphics;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  length: number;
  offset: number;  // 0..1 along the edge
  speed: number;   // units per ms
}

interface PulseRing {
  gfx: Graphics;
  x: number;
  y: number;
  phase: number;
}

export class EffectLayer {
  readonly container = new Container();
  private particles: RouteParticle[] = [];
  private pulseRings: PulseRing[] = [];
  private particleContainer = new Container();
  private pulseContainer = new Container();

  constructor() {
    this.container.addChild(this.pulseContainer);
    this.container.addChild(this.particleContainer);
  }

  /** Sync route particles: only show on route edges */
  syncRoute(connections: ConnectionData[], systems: SystemNodeData[]) {
    // Clear old particles
    this.clearParticles();

    const posMap = new Map<string, { x: number; y: number }>();
    for (const s of systems) posMap.set(s.id, { x: s.x, y: s.y });

    const routeEdges = connections.filter((c) => c.isRoute);
    for (const edge of routeEdges) {
      const from = posMap.get(edge.fromId);
      const to = posMap.get(edge.toId);
      if (!from || !to) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) continue;

      for (let i = 0; i < ANIM.particlesPerEdge; i++) {
        const gfx = new Graphics();
        gfx.circle(0, 0, 2);
        gfx.fill({ color: NAV_COLORS.route_hop, alpha: 0.8 });
        this.particleContainer.addChild(gfx);

        this.particles.push({
          gfx,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          length,
          offset: i / ANIM.particlesPerEdge,
          speed: ANIM.particleSpeed / length / 1000,  // fraction per ms
        });
      }
    }
  }

  /** Sync pulse rings on systems with ships (default mode only) */
  syncPulseRings(systems: SystemNodeData[], isDefaultMode: boolean) {
    this.clearPulseRings();
    if (!isDefaultMode) return;

    for (const sys of systems) {
      if (sys.shipCount <= 0) continue;

      const gfx = new Graphics();
      this.pulseContainer.addChild(gfx);
      this.pulseRings.push({
        gfx,
        x: sys.x,
        y: sys.y,
        phase: Math.random() * ANIM.pulseRingPeriod,
      });
    }
  }

  update(dtMs: number) {
    // Animate route particles
    for (const p of this.particles) {
      p.offset = (p.offset + p.speed * dtMs) % 1;
      const x = p.fromX + (p.toX - p.fromX) * p.offset;
      const y = p.fromY + (p.toY - p.fromY) * p.offset;
      p.gfx.position.set(x, y);
    }

    // Animate pulse rings
    for (const ring of this.pulseRings) {
      ring.phase = (ring.phase + dtMs) % ANIM.pulseRingPeriod;
      const t = ring.phase / ANIM.pulseRingPeriod;
      const radius = 12 + (ANIM.pulseRingMaxRadius - 12) * t;
      const alpha = 0.4 * (1 - t);

      ring.gfx.clear();
      ring.gfx.circle(ring.x, ring.y, radius);
      ring.gfx.stroke({ color: NAV_COLORS.origin, width: 1.5, alpha });
    }
  }

  private clearParticles() {
    for (const p of this.particles) {
      p.gfx.destroy();
    }
    this.particles = [];
    this.particleContainer.removeChildren();
  }

  private clearPulseRings() {
    for (const ring of this.pulseRings) {
      ring.gfx.destroy();
    }
    this.pulseRings = [];
    this.pulseContainer.removeChildren();
  }

  destroy() {
    this.clearParticles();
    this.clearPulseRings();
    this.container.destroy({ children: true });
  }
}
