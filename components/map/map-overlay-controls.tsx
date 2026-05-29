"use client";

import { tv } from "tailwind-variants";
import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import { MAP_MODES, type MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { PRICE_RAMP_STOPS } from "@/lib/utils/price-ramp";

// Vertical full-width rows, copper left-accent stripe on the active one. Shared
// by Territory (radio) and Overlays (toggle). `group/chip` scopes the hover
// tooltip so it doesn't react to the panel as a whole.
const rowVariants = tv({
  base: [
    "group/chip relative flex items-center gap-2 w-full cursor-pointer",
    "px-3 py-1.5 text-xs font-medium uppercase tracking-wider",
    "border-l-2 transition-colors duration-150",
    "focus:outline-none",
    "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
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
  base: "ml-auto h-2 w-2 shrink-0 transition-colors duration-150",
  variants: {
    active: {
      true: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
      false: "bg-border-strong group-hover/chip:bg-text-secondary",
    },
  },
});

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  none: "None",
};

/** Overlays whose colour mapping isn't self-evident carry a hover legend. */
type LegendKind = "price" | "tradeFlow" | "routes";

interface OverlayDef {
  key: MapOverlayKey;
  label: string;
  /** CSS swatch colour — matches the glyph element this overlay paints. */
  swatch: string;
  /** Optional hover-tooltip legend (kept out of the panel's permanent height). */
  legend?: LegendKind;
}

/**
 * Order matters — this is also the rendered (top-to-bottom) order. Swatches are
 * pulled from the same constants the Pixi renderer uses so they can't drift.
 */
const OVERLAY_DEFS: ReadonlyArray<OverlayDef> = [
  { key: "fleet", label: "Fleet", swatch: "#38bdf8" }, // FLEET.pillFill (sky-400)
  { key: "events", label: "Events", swatch: "#f59e0b" }, // EVENT_DOT_COLORS.amber
  { key: "priceHeatmap", label: "Price", swatch: PRICE_RAMP_STOPS.premium, legend: "price" },
  { key: "tradeFlow", label: "Trade Flows", swatch: pixiHexToCss(TIER_COLOR[2]), legend: "tradeFlow" },
  { key: "shipRoutes", label: "Ship Routes", swatch: "#38bdf8", legend: "routes" },
];

interface MapOverlayControlsProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * The primary map control panel — Territory (single-select tint) over Overlays
 * (multi-select additive layers). Vertically stacked so every label has room.
 * Positioning is owned by the parent dock ([map-controls-dock.tsx]); the Price
 * good-picker lives in its own floating panel so it can't reflow this one.
 *
 * Foundry theme: sharp corners, surface background, copper accent on the active
 * row. Legends live in hover tooltips so the panel stays compact.
 */
export function MapOverlayControls({
  mode,
  setMode,
  overlays,
  toggle,
}: MapOverlayControlsProps) {
  return (
    <div className="w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
          Map
        </h3>
      </div>

      <SectionHeading>Territory</SectionHeading>
      <ul role="radiogroup" aria-label="Territory">
        {MAP_MODES.map((m) => {
          const active = m === mode;
          return (
            <li key={m}>
              <label className={rowVariants({ active })}>
                <input
                  type="radio"
                  name="mapMode"
                  value={m}
                  checked={active}
                  onChange={() => setMode(m)}
                  className="sr-only"
                />
                <span>{MODE_LABELS[m]}</span>
                <span className={dotVariants({ active })} aria-hidden />
              </label>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border" />
      <SectionHeading>Overlays</SectionHeading>
      <ul role="group" aria-label="Map overlays">
        {OVERLAY_DEFS.map(({ key, label, swatch, legend }) => {
          const active = overlays[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={active}
                className={rowVariants({ active })}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 transition-opacity duration-150"
                  style={{ backgroundColor: swatch, opacity: active ? 1 : 0.35 }}
                  aria-hidden
                />
                <span className="truncate">{label}</span>
                {legend && <LegendTooltip kind={legend} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="px-3 pt-2 pb-1">
      <h4 className="text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        {children}
      </h4>
    </div>
  );
}

/**
 * Floating legend shown on row hover. Positioned to the right of the row and
 * `pointer-events-none`, so it never grows the panel, overlaps other rows, or
 * eats clicks.
 */
function LegendTooltip({ kind }: { kind: LegendKind }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden w-44 -translate-y-1/2 border border-border bg-surface px-2 py-1.5 text-left shadow-lg group-hover/chip:block"
    >
      {kind === "price" && <PriceRampLegend />}
      {kind === "tradeFlow" && <TradeFlowLegend />}
      {kind === "routes" && (
        <p className="text-[10px] leading-relaxed text-text-secondary normal-case tracking-normal">
          Every in-transit ship&apos;s route. Markers stay visible at all zooms
          — hover one for its ETA, click to pin its route.
        </p>
      )}
    </div>
  );
}

function PriceRampLegend() {
  const ramp = [
    PRICE_RAMP_STOPS.deepBargain,
    PRICE_RAMP_STOPS.bargain,
    PRICE_RAMP_STOPS.neutral,
    PRICE_RAMP_STOPS.premium,
    PRICE_RAMP_STOPS.deepPremium,
  ];
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Price vs Base
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: `linear-gradient(to right, ${ramp.join(", ")})` }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>0.6×</span>
        <span>base</span>
        <span>1.4×</span>
      </div>
    </div>
  );
}

function TradeFlowLegend() {
  const tiers = [0, 1, 2] as const;
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Good Tier
      </h5>
      <ul className="space-y-0.5">
        {tiers.map((tier) => (
          <li
            key={tier}
            className="flex items-center gap-1.5 text-[10px] text-text-secondary normal-case tracking-normal"
          >
            <span
              className="h-2 w-2 shrink-0"
              style={{ backgroundColor: pixiHexToCss(TIER_COLOR[tier]) }}
              aria-hidden
            />
            <span>{TIER_LABEL[tier]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
