import { Graphics, ParticleContainer, Particle, Texture } from "pixi.js";
import type { Renderer } from "pixi.js";
import type { AtlasSystem } from "@/lib/types/game";
import { ECONOMY_COLORS, POINT_CLOUD } from "../theme";

/**
 * GPU-accelerated point cloud for universe view.
 * Renders all systems as economy-colored dots using ParticleContainer.
 * Not interactive — no pointer events.
 */
export class PointCloudLayer {
  readonly container = new ParticleContainer({
    dynamicProperties: {
      position: false,
      color: false,
      rotation: false,
      uvs: false,
      vertex: false,
    },
  });

  private particles = new Map<string, Particle>();
  private dotTexture: Texture | null = null;

  /** Generate the shared circle texture. Must be called once after renderer is ready. */
  init(renderer: Renderer) {
    const size = POINT_CLOUD.textureSize;
    const half = size / 2;

    const g = new Graphics();
    g.circle(half, half, half);
    g.fill({ color: 0xffffff });

    this.dotTexture = renderer.generateTexture({
      target: g,
      resolution: 2,
    });
    g.destroy();
  }

  /** Sync particles to match current atlas data */
  sync(systems: AtlasSystem[]) {
    if (!this.dotTexture) return;

    const incoming = new Set<string>();

    for (const sys of systems) {
      incoming.add(sys.id);

      let p = this.particles.get(sys.id);
      if (!p) {
        p = new Particle({
          texture: this.dotTexture,
          anchorX: 0.5,
          anchorY: 0.5,
        });
        this.particles.set(sys.id, p);
        this.container.addParticle(p);
      }

      p.x = sys.x;
      p.y = sys.y;
      p.tint = ECONOMY_COLORS[sys.economyType].core;

      const scale = sys.isGateway
        ? POINT_CLOUD.dotRadius * POINT_CLOUD.gatewayScale / (POINT_CLOUD.textureSize / 2)
        : POINT_CLOUD.dotRadius / (POINT_CLOUD.textureSize / 2);
      p.scaleX = scale;
      p.scaleY = scale;
    }

    // Remove stale particles
    for (const [id, p] of this.particles) {
      if (!incoming.has(id)) {
        this.container.removeParticle(p);
        this.particles.delete(id);
      }
    }

    // Tell ParticleContainer to re-upload static buffers
    this.container.update();
  }

  /** Set container alpha for crossfade. Called per-frame. */
  updateVisibility(alpha: number) {
    this.container.visible = alpha > 0;
    this.container.alpha = alpha;
  }

  destroy() {
    this.particles.clear();
    this.dotTexture?.destroy();
    this.dotTexture = null;
    this.container.destroy({ children: true });
  }
}
