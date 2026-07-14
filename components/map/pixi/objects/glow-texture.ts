import { Texture } from "pixi.js";

/** Square px size of the shared glow texture. Large enough that scaling up at
 *  max zoom stays smooth. */
export const GLOW_TEXTURE_SIZE = 128;

let cached: Texture | null = null;

/**
 * Shared soft radial-gradient disc — opaque white centre fading to fully
 * transparent at the edge. Each system dot uses one tinted Sprite of this
 * texture, so a single texture serves every glow. Created lazily (browser-only:
 * a 2D-canvas gradient fades far more smoothly than stacked Graphics discs, and
 * a texture bilinear-samples cleanly when the dot scales up at max zoom).
 */
export function getGlowTexture(): Texture {
  if (cached) return cached;

  const size = GLOW_TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // 2D context is effectively always available in the browser; fall back to a
    // flat texture rather than crash if it ever isn't.
    cached = Texture.WHITE;
    return cached;
  }

  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  cached = Texture.from(canvas);
  return cached;
}
