"use client";

import { tv } from "tailwind-variants";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";

const toggleVariants = tv({
  base: [
    "group flex items-center justify-between gap-3 w-full",
    "px-3 py-1.5 text-xs font-medium uppercase tracking-wider",
    "border-l-2 transition-colors duration-150",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  ],
  variants: {
    active: {
      true: "border-l-accent bg-accent/10 text-text-accent hover:bg-accent/20",
      false:
        "border-l-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary",
    },
  },
});

const dotVariants = tv({
  base: "h-2 w-2 transition-colors duration-150",
  variants: {
    active: {
      true: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
      false: "bg-border-strong group-hover:bg-text-secondary",
    },
  },
});

interface OverlayDef {
  key: MapOverlayKey;
  label: string;
}

/**
 * Order matters — this is also the rendered order in the cluster. Keep the
 * most-used overlay at the top so it stays the first click as the cluster
 * grows past a single toggle.
 */
const OVERLAY_DEFS: ReadonlyArray<OverlayDef> = [
  { key: "tradeFlow", label: "Trade Flows" },
];

interface MapOverlayControlsProps {
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * Floating cluster of overlay-toggle buttons, anchored bottom-left of the
 * map canvas (just to the right of the game sidebar). PR 2 ships the Trade
 * Flows toggle; future overlays (danger heatmap, faction control, scan
 * ranges) drop into `OVERLAY_DEFS` without touching the surrounding markup.
 *
 * Foundry theme: sharp corners, surface background. The cluster intentionally
 * has NO copper left stripe — each active toggle has its own copper accent,
 * and a container stripe would double up visually on the active row.
 */
export function MapOverlayControls({
  overlays,
  toggle,
}: MapOverlayControlsProps) {
  return (
    <div className="absolute bottom-4 left-4 z-40 w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
          Overlays
        </h3>
      </div>
      <ul>
        {OVERLAY_DEFS.map(({ key, label }) => {
          const active = overlays[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={active}
                className={toggleVariants({ active })}
              >
                <span>{label}</span>
                <span className={dotVariants({ active })} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
