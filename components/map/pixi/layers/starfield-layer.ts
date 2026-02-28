import { Container, Graphics } from "pixi.js";
import { STARFIELD, ANIM } from "../theme";

interface Star {
  x: number;
  y: number;
  size: number;
  baseAlpha: number;
  phase: number;       // random twinkle phase offset
  period: number;      // twinkle period in ms
}

/** Seeded pseudo-random number generator (mulberry32) */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class StarfieldLayer {
  readonly container = new Container();
  private layerData: { stars: Star[]; gfx: Graphics; parallax: number }[] = [];
  private time = 0;

  init(seed = 42) {
    const rng = mulberry32(seed);
    const { layers, fieldSize } = STARFIELD;

    for (const cfg of layers) {
      const stars: Star[] = [];
      for (let i = 0; i < cfg.count; i++) {
        stars.push({
          x: (rng() - 0.5) * 2 * fieldSize,
          y: (rng() - 0.5) * 2 * fieldSize,
          size: lerp(cfg.sizeMin, cfg.sizeMax, rng()),
          baseAlpha: lerp(cfg.alphaMin, cfg.alphaMax, rng()),
          phase: rng() * Math.PI * 2,
          period: lerp(ANIM.twinkleMinPeriod, ANIM.twinkleMaxPeriod, rng()),
        });
      }

      const gfx = new Graphics();
      this.container.addChild(gfx);
      this.layerData.push({ stars, gfx, parallax: cfg.parallax });
    }

    this.drawAll();
  }

  /**
   * Update parallax positions based on camera world center.
   * Also handles twinkle animation.
   */
  update(cameraX: number, cameraY: number, dtMs: number) {
    this.time += dtMs;

    for (const layer of this.layerData) {
      layer.gfx.position.set(-cameraX * layer.parallax, -cameraY * layer.parallax);
    }

    // Redraw stars every ~4 frames for twinkle (perf: don't redraw every frame)
    if (Math.floor(this.time / 64) !== Math.floor((this.time - dtMs) / 64)) {
      this.drawAll();
    }
  }

  private drawAll() {
    for (const layer of this.layerData) {
      const gfx = layer.gfx;
      gfx.clear();

      for (const star of layer.stars) {
        const twinkle = 0.7 + 0.3 * Math.sin((this.time / star.period) * Math.PI * 2 + star.phase);
        const alpha = star.baseAlpha * twinkle;
        gfx.circle(star.x, star.y, star.size);
        gfx.fill({ color: 0xffffff, alpha });
      }
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
