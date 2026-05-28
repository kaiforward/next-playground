"use client";

import { useMemo } from "react";
import { tv } from "tailwind-variants";
import {
  TIER_COLOR,
  TIER_LABEL,
  pixiHexToCss,
} from "@/lib/constants/good-colors";
import type { GoodTier } from "@/lib/types/game";
import { MAP_MODES, type MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { SelectInput } from "@/components/form/select-input";
import { Button } from "@/components/ui/button";
import { PRICE_RAMP_STOPS } from "@/lib/utils/price-ramp";

// Focus ring works two ways so this variant can wrap either a focusable element
// (the overlay <button>) or an element that contains one (the Mode <label> with
// a sr-only <input type="radio"> inside). `focus-visible:` handles the first
// case, `has-[:focus-visible]:` the second.
const rowVariants = tv({
  base: [
    "group flex items-center justify-between gap-3 w-full cursor-pointer",
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
  base: "h-2 w-2 transition-colors duration-150",
  variants: {
    active: {
      true: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
      false: "bg-border-strong group-hover:bg-text-secondary",
    },
  },
});

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  none: "None",
};

interface OverlayDef {
  key: MapOverlayKey;
  label: string;
}

/**
 * Order matters — this is also the rendered order in the cluster. Keep the
 * most-used overlay at the top.
 */
const OVERLAY_DEFS: ReadonlyArray<OverlayDef> = [
  { key: "tradeFlow", label: "Trade Flows" },
  { key: "priceHeatmap", label: "Price" },
];

interface MapOverlayControlsProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
  /** Required when the Price overlay is on. Null until a good is picked. */
  priceGoodId: string | null;
  setPriceGoodId: (goodId: string | null) => void;
  /** Sorted goods list for the picker. */
  goods: { id: string; name: string }[];
  /** Open the cross-system comparison panel. Disabled until a good is picked. */
  onOpenComparisonTable: () => void;
}

/**
 * Floating cluster anchored bottom-left of the map canvas. Two axes:
 *
 *   1. **Map Mode** (single-select) — paints the territory polygons. One tint
 *      at a time. `none` hides both territory layers.
 *   2. **Overlays** (multi-select) — additive layers on top of the polygons,
 *      stackable freely.
 *
 * Foundry theme: sharp corners, surface background, copper left-accent stripe
 * on the active row. The cluster intentionally has NO container-level stripe
 * — the active row carries the accent.
 */
export function MapOverlayControls({
  mode,
  setMode,
  overlays,
  toggle,
  priceGoodId,
  setPriceGoodId,
  goods,
  onOpenComparisonTable,
}: MapOverlayControlsProps) {
  return (
    <div className="absolute bottom-4 left-4 z-20 w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
          Map
        </h3>
      </div>

      <ModeSection mode={mode} setMode={setMode} />

      <div className="border-t border-border px-3 pt-2 pb-1">
        <h4 className="text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
          Overlays
        </h4>
      </div>
      <ul role="group" aria-label="Map overlays">
        {OVERLAY_DEFS.map(({ key, label }) => {
          const active = overlays[key];
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={active}
                className={rowVariants({ active })}
              >
                <span>{label}</span>
                <span className={dotVariants({ active })} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {overlays.tradeFlow && <TradeFlowLegend />}
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

function ModeSection({
  mode,
  setMode,
}: {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
}) {
  return (
    <>
      <div className="px-3 pt-2 pb-1">
        <h4 className="text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
          Mode
        </h4>
      </div>
      <ul role="radiogroup" aria-label="Map mode">
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
    </>
  );
}

/**
 * Shown only when the Price overlay is on. Lets the user pick a good (for the
 * forthcoming Pixi tint) and jump straight to the cross-system comparison
 * panel. Empty state (no good picked) just shows the picker + legend.
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
      <PriceRampLegend />
    </div>
  );
}

function PriceRampLegend() {
  const stops: { color: string; label: string }[] = [
    { color: PRICE_RAMP_STOPS.deepBargain, label: "≤ 0.6x" },
    { color: PRICE_RAMP_STOPS.bargain, label: "0.85x" },
    { color: PRICE_RAMP_STOPS.neutral, label: "base" },
    { color: PRICE_RAMP_STOPS.premium, label: "1.15x" },
    { color: PRICE_RAMP_STOPS.deepPremium, label: "≥ 1.4x" },
  ];
  return (
    <div className="pt-1">
      <h4 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Price vs Base
      </h4>
      <ul className="space-y-0.5">
        {stops.map((s) => (
          <li
            key={s.color}
            className="flex items-center gap-2 text-[10px] text-text-secondary"
          >
            <span
              className="h-2 w-4 shrink-0"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tier-colour legend shown only when the Trade Flows overlay is on. Colours
 * come from `TIER_COLOR` so they can't drift from the Pixi renderer.
 */
function TradeFlowLegend() {
  const tiers: GoodTier[] = [0, 1, 2];
  return (
    <div className="border-t border-border px-3 py-2">
      <h4 className="mb-1.5 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Good Tier
      </h4>
      <ul className="space-y-1">
        {tiers.map((tier) => (
          <li
            key={tier}
            className="flex items-center gap-2 text-[11px] text-text-secondary"
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
