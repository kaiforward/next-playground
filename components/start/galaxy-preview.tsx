"use client";

import { useEffect, useRef, useState } from "react";
import type { GalaxyShapeKnobs } from "@/lib/engine/density-field";
import {
  buildGalaxyImpression,
  renderDensityField,
  worldToCanvas,
  type GalaxyImpression,
} from "./galaxy-preview-render";

/** Square canvas side, in CSS pixels — the density field and every dot/line project onto this. */
const CANVAS_SIZE = 480;

/** Regeneration debounce: a slider drag fires many onChange events per second, and rebuilding a
 *  large galaxy's placement on every one of them would visibly stutter the control itself. Flagged
 *  at review — 150ms reads as "live" without recomputing on every intermediate drag value. */
const REGEN_DEBOUNCE_MS = 150;

/** Corridor-crossing lane tint — a faint version of the Foundry `accent` token (`#d06a42`), thin
 *  enough to read as a line under the star field rather than compete with it. Waypoint-band
 *  corridors are already visible as raised density in the field itself (`density-field.ts`), so
 *  only crossing-style pairs get an explicit line here — the cheaper of the two to draw, since a
 *  crossing is always exactly one segment. */
const CROSSING_LINE_COLOR = "rgba(208, 106, 66, 0.35)";
const STAR_DOT_COLOR = "#e8dcc8";

export interface GalaxyPreviewProps {
  knobs: GalaxyShapeKnobs;
  seed: number;
  systemCount: number;
}

/**
 * Renders a fast impression of the candidate galaxy a New Game's structure knobs would produce:
 * the density field as a canvas `ImageData` paint, star dots at the real engine's placement
 * coordinates (same draw order as `generateWorld`, spec §5's determinism seam), and corridor
 * crossing lines. Regenerates whenever `knobs`/`seed`/`systemCount` change (debounced).
 *
 * Renders on the MAIN THREAD (New Game dialog), so nothing this module imports may reach
 * `lib/constants/economy-scale` — see `galaxy-preview-render.ts`'s docstring for the import-graph
 * reasoning. Under jsdom (component tests) `getContext("2d")` returns null; painting is skipped and
 * the canvas element still renders, so a test can assert structure/text without a real canvas.
 */
export function GalaxyPreview({ knobs, seed, systemCount }: GalaxyPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [impression, setImpression] = useState<GalaxyImpression | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setImpression(buildGalaxyImpression(knobs, seed, systemCount));
    }, REGEN_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- individual knob fields, not the
    // `knobs` object identity, are the real dependency: callers rebuild the knobs object every
    // render.
  }, [
    knobs.clusterCount,
    knobs.sizeSkew,
    knobs.clusterSpacing,
    knobs.voidFloor,
    knobs.corridorsPerCluster,
    knobs.corridorStyle,
    seed,
    systemCount,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !impression) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom, or a browser with canvas disabled — the element still renders

    const bytes = renderDensityField(impression.shape.grid, CANVAS_SIZE, CANVAS_SIZE);
    ctx.putImageData(new ImageData(bytes, CANVAS_SIZE, CANVAS_SIZE), 0, 0);

    ctx.strokeStyle = CROSSING_LINE_COLOR;
    ctx.lineWidth = 1;
    for (const pair of impression.shape.corridors.pairs) {
      if (pair.style !== "crossing") continue;
      const a = impression.shape.seeds[pair.a];
      const b = impression.shape.seeds[pair.b];
      const pa = worldToCanvas(a.x, a.y, impression.mapSize, CANVAS_SIZE, CANVAS_SIZE);
      const pb = worldToCanvas(b.x, b.y, impression.mapSize, CANVAS_SIZE, CANVAS_SIZE);
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
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        role="img"
        aria-label="Galaxy generation preview"
        className="border border-border bg-background"
      />
      <p className="text-xs font-mono text-text-secondary">
        {impression
          ? `${impression.points.length.toLocaleString()} systems placed · seed ${seed}`
          : "Generating…"}
      </p>
    </div>
  );
}
