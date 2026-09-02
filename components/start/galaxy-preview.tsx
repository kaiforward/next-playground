"use client";

import { useEffect, useRef, useState } from "react";
import type { GalaxyShapeKnobs } from "@/lib/engine/density-field";
import {
  buildGalaxyImpression,
  renderDensityField,
  worldToCanvas,
  crossingSegments,
  type ImpressionOverrides,
  type GalaxyImpression,
} from "@/lib/engine/galaxy-impression";

/** Square canvas side, in device pixels — the density field and every dot/line project onto this.
 *  Big on purpose: at small sizes dense cluster cores merge into a single blob and crossings
 *  vanish; 900 keeps individual dots readable at the default 600-system count. The element itself
 *  scales down to whatever width the dialog leaves it (`max-w-full h-auto`), so a narrow viewport
 *  shrinks the picture rather than clipping it. */
const CANVAS_SIZE = 900;

/** Regeneration debounce: a slider drag fires many onChange events per second, and rebuilding a
 *  large galaxy's placement on every one of them would visibly stutter the control itself. Flagged
 *  at review — 150ms reads as "live" without recomputing on every intermediate drag value. */
const REGEN_DEBOUNCE_MS = 150;

/** Corridor-crossing lane tint — a faint version of the Foundry `accent` token (`#d06a42`), thin
 *  enough to read as a line under the star field rather than compete with it. Waypoint-band
 *  corridors are already visible as raised density in the field itself (`density-field.ts`), so
 *  only crossing-style pairs get an explicit line here — the cheaper of the two to draw, since a
 *  crossing is always exactly one segment. */
const CROSSING_LINE_COLOR = "rgba(208, 106, 66, 0.75)";
const STAR_DOT_COLOR = "#e8dcc8";

/** Exactly what `buildGalaxyImpression` is called with — serialised into `inputKey` so the
 *  regeneration effect depends on the input's values, never on object identity. */
interface PreviewInput {
  knobs: GalaxyShapeKnobs;
  seed: number;
  systemCount: number;
  overrides?: ImpressionOverrides;
}

export interface GalaxyPreviewProps {
  knobs: GalaxyShapeKnobs;
  seed: number;
  systemCount: number;
  /** Dev-exploration overrides (styleguide only for now): map-size scale plus placement levers;
   *  omitted = the engine's values. */
  overrides?: ImpressionOverrides;
}

/**
 * Renders a fast impression of the candidate galaxy a New Game's structure knobs would produce:
 * the density field as a canvas `ImageData` paint, star dots at the real engine's placement
 * coordinates (same draw order as `generateWorld`, spec §5's determinism seam), and corridor
 * crossing lines. Regenerates whenever `knobs`/`seed`/`systemCount` change (debounced).
 *
 * Renders on the MAIN THREAD (New Game dialog), so nothing this module imports may reach
 * `lib/constants/economy-scale` — see `lib/engine/galaxy-impression.ts`'s docstring for the import-graph
 * reasoning. Under jsdom (component tests) `getContext("2d")` returns null; painting is skipped and
 * the canvas element still renders, so a test can assert structure/text without a real canvas.
 */
export function GalaxyPreview({ knobs, seed, systemCount, overrides }: GalaxyPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [impression, setImpression] = useState<GalaxyImpression | null>(null);

  // Callers rebuild the `knobs`/`overrides` objects every render, so their identity is never the
  // real dependency — their VALUES are. Serialising the whole input is what keeps a knob added
  // later from silently never regenerating the preview, which a hand-listed field set would; the
  // ref carries the live objects across so the effect reads them without depending on identity.
  const inputKey = JSON.stringify({ knobs, seed, systemCount, overrides });
  const input = useRef<PreviewInput>({ knobs, seed, systemCount, overrides });
  input.current = { knobs, seed, systemCount, overrides };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const { knobs: liveKnobs, seed: liveSeed, systemCount: liveCount, overrides: liveOverrides } = input.current;
      setImpression(
        buildGalaxyImpression(liveKnobs, liveSeed, liveCount, {
          mapSizeScale: liveOverrides?.mapSizeScale,
          minDistanceScale: liveOverrides?.minDistanceScale,
          densityRadiusExponent: liveOverrides?.densityRadiusExponent,
        }),
      );
    }, REGEN_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [inputKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !impression) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom, or a browser with canvas disabled — the element still renders

    const bytes = renderDensityField(impression.shape.grid, CANVAS_SIZE, CANVAS_SIZE);
    ctx.putImageData(new ImageData(bytes, CANVAS_SIZE, CANVAS_SIZE), 0, 0);

    ctx.strokeStyle = CROSSING_LINE_COLOR;
    ctx.lineWidth = 2;
    for (const segment of crossingSegments(impression)) {
      const pa = worldToCanvas(segment.a.x, segment.a.y, impression.mapSize, CANVAS_SIZE, CANVAS_SIZE);
      const pb = worldToCanvas(segment.b.x, segment.b.y, impression.mapSize, CANVAS_SIZE, CANVAS_SIZE);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    ctx.fillStyle = STAR_DOT_COLOR;
    for (const point of impression.points) {
      const p = worldToCanvas(point.x, point.y, impression.mapSize, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillRect(p.x, p.y, 1, 1);
    }
  }, [impression]);

  return (
    <div className="space-y-1 w-full max-w-[900px] min-w-0">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        role="img"
        aria-label="Galaxy generation preview"
        className="border border-border bg-background max-w-full h-auto"
      />
      <p className="text-xs font-mono text-text-secondary">
        {impression
          ? `${impression.points.length.toLocaleString()} systems placed · seed ${seed} · ${impression.mapSize.toLocaleString()} × ${impression.mapSize.toLocaleString()} units`
          : "Generating…"}
      </p>
    </div>
  );
}
