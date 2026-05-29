"use client";

import { useMemo } from "react";
import { tv } from "tailwind-variants";
import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import { MAP_MODES, type MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { PRESETS, type MapPreset } from "@/lib/utils/map-presets";
import { SelectInput } from "@/components/form/select-input";
import { Button } from "@/components/ui/button";
import { PRICE_RAMP_STOPS } from "@/lib/utils/price-ramp";

// ── Variants ────────────────────────────────────────────────────────
// Preset + territory segments: copper accent on the active choice, muted
// otherwise. Sharp corners per Foundry (the HTML UI; the WebGL map is its own
// surface).
const chipVariants = tv({
  base: [
    "px-2 py-1 text-[10px] font-medium uppercase tracking-wider",
    "border transition-colors duration-150",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  ],
  variants: {
    active: {
      true: "border-accent bg-accent/15 text-text-accent",
      false:
        "border-border bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary",
    },
  },
});

const segmentVariants = tv({
  base: [
    "flex-1 cursor-pointer text-center",
    "px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider",
    "border transition-colors duration-150",
    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
  ],
  variants: {
    active: {
      true: "border-accent bg-accent/15 text-text-accent",
      false:
        "border-border bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary",
    },
  },
});

// Overlay chips: a persistent colour swatch identifies the glyph element each
// overlay paints (so the legend is implicit); the swatch dims when off. The
// `group/chip` + `relative` live on the wrapper so the legend tooltip can pop
// above without growing the panel.
const overlayChipVariants = tv({
  base: [
    "flex items-center gap-2 w-full cursor-pointer",
    "px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider",
    "border transition-colors duration-150",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  ],
  variants: {
    active: {
      true: "border-accent/60 bg-accent/10 text-text-primary",
      false:
        "border-border bg-transparent text-text-secondary hover:bg-surface-hover",
    },
  },
});

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  none: "None",
};

const PRESET_LABELS: Record<MapPreset, string> = {
  default: "Default",
  trader: "Trader",
  navigator: "Navigator",
  custom: "Custom",
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
 * Order matters — this is also the rendered order in the 2-col grid. Swatches
 * are pulled from the same constants the Pixi renderer uses so they can't drift.
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
  preset: MapPreset;
  setPreset: (preset: MapPreset) => void;
  /** Required when the Price overlay is on. Null until a good is picked. */
  priceGoodId: string | null;
  setPriceGoodId: (goodId: string | null) => void;
  /** Sorted goods list for the picker. */
  goods: { id: string; name: string }[];
  /** Open the cross-system comparison panel. Disabled until a good is picked. */
  onOpenComparisonTable: () => void;
}

/**
 * Floating cluster anchored bottom-left of the map canvas. Three controls:
 *
 *   1. **Preset** — one-click curated overlay bundles (Default / Trader /
 *      Navigator). Toggling any overlay by hand drops to a derived "Custom".
 *   2. **Territory** (single-select segmented) — paints the territory polygons.
 *   3. **Overlays** (multi-select grid) — additive layers, stackable freely.
 *
 * Foundry theme: sharp corners, surface background, copper accent on active
 * controls. Legends live in hover tooltips so the panel stays compact.
 */
export function MapOverlayControls({
  mode,
  setMode,
  overlays,
  toggle,
  preset,
  setPreset,
  priceGoodId,
  setPriceGoodId,
  goods,
  onOpenComparisonTable,
}: MapOverlayControlsProps) {
  return (
    <div className="absolute bottom-4 left-4 z-20 w-52 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
          Map
        </h3>
      </div>

      <PresetRow preset={preset} setPreset={setPreset} />
      <TerritorySegment mode={mode} setMode={setMode} />

      <div className="border-t border-border px-3 pt-2 pb-1">
        <h4 className="text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
          Overlays
        </h4>
      </div>
      <div
        role="group"
        aria-label="Map overlays"
        className="grid grid-cols-2 gap-1.5 px-3 pb-2.5"
      >
        {OVERLAY_DEFS.map(({ key, label, swatch, legend }) => {
          const active = overlays[key];
          return (
            <div key={key} className="group/chip relative">
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={active}
                className={overlayChipVariants({ active })}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 transition-opacity duration-150"
                  style={{ backgroundColor: swatch, opacity: active ? 1 : 0.35 }}
                  aria-hidden
                />
                <span className="truncate">{label}</span>
              </button>
              {legend && <LegendTooltip kind={legend} />}
            </div>
          );
        })}
      </div>

      {overlays.priceHeatmap && (
        <PriceOverlaySection
          priceGoodId={priceGoodId}
          setPriceGoodId={setPriceGoodId}
          goods={goods}
          onOpenComparisonTable={onOpenComparisonTable}
        />
      )}
    </div>
  );
}

/**
 * Floating legend shown on chip hover. Absolutely positioned above the chip and
 * `pointer-events-none`, so it never grows the panel or eats clicks. The panel
 * sits at the bottom-left of the viewport, so legends open upward.
 */
function LegendTooltip({ kind }: { kind: LegendKind }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-0 z-30 mb-1.5 hidden w-44 border border-border bg-surface px-2 py-1.5 shadow-lg group-hover/chip:block"
    >
      {kind === "price" && <PriceRampLegend />}
      {kind === "tradeFlow" && <TradeFlowLegend />}
      {kind === "routes" && (
        <p className="text-[10px] leading-relaxed text-text-secondary">
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
            className="flex items-center gap-1.5 text-[10px] text-text-secondary"
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

/**
 * One-click overlay bundles. Custom is a derived state — it only appears (and
 * is non-interactive) when the live overlay set matches no preset.
 */
function PresetRow({
  preset,
  setPreset,
}: {
  preset: MapPreset;
  setPreset: (preset: MapPreset) => void;
}) {
  return (
    <div className="border-t border-border px-3 pt-2 pb-2.5">
      <h4 className="mb-1.5 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Preset
      </h4>
      <div role="group" aria-label="Map presets" className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const active = p === preset;
          // "Custom" is derived, not selectable — show it only while active.
          if (p === "custom" && !active) return null;
          const isCustom = p === "custom";
          return (
            <button
              key={p}
              type="button"
              disabled={isCustom}
              onClick={isCustom ? undefined : () => setPreset(p)}
              aria-pressed={active}
              className={chipVariants({ active })}
            >
              {PRESET_LABELS[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Territory tint, single-select. `none` hides both territory layers. Rendered
 * as a 3-segment horizontal control (sr-only radios keep it a real radiogroup).
 */
function TerritorySegment({
  mode,
  setMode,
}: {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
}) {
  return (
    <div className="border-t border-border px-3 pt-2 pb-2.5">
      <h4 className="mb-1.5 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Territory
      </h4>
      <div role="radiogroup" aria-label="Territory" className="flex gap-1">
        {MAP_MODES.map((m) => {
          const active = m === mode;
          return (
            <label key={m} className={segmentVariants({ active })}>
              <input
                type="radio"
                name="mapMode"
                value={m}
                checked={active}
                onChange={() => setMode(m)}
                className="sr-only"
              />
              {MODE_LABELS[m]}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Shown only when the Price overlay is on. Lets the user pick a good (for the
 * Pixi halo/pill tint) and jump to the cross-system comparison panel.
 */
function PriceOverlaySection({
  priceGoodId,
  setPriceGoodId,
  goods,
  onOpenComparisonTable,
}: {
  priceGoodId: string | null;
  setPriceGoodId: (goodId: string | null) => void;
  goods: { id: string; name: string }[];
  onOpenComparisonTable: () => void;
}) {
  const options = useMemo<{ value: string | null; label: string }[]>(
    () => [
      { value: null, label: "Select a good…" },
      ...goods.map((g) => ({ value: g.id, label: g.name })),
    ],
    [goods]
  );
  return (
    <div className="border-t border-border px-3 py-2 space-y-2">
      <SelectInput<string | null>
        label="Good"
        size="sm"
        options={options}
        value={priceGoodId}
        onChange={setPriceGoodId}
        valueKey={(v) => v ?? ""}
        isSearchable
      />
      {priceGoodId && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          fullWidth
          onClick={onOpenComparisonTable}
        >
          Show all prices
        </Button>
      )}
    </div>
  );
}
