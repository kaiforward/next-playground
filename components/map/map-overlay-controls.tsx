"use client";

import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import { MAP_MODES, type MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import { PRICE_RAMP_STOPS } from "@/lib/utils/price-ramp";
import { STABILITY_RAMP_STOPS } from "@/lib/utils/stability";
import { RadioGroup } from "@/components/form/radio-group";
import { CheckboxInput } from "@/components/form/checkbox-input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  stability: "Stability",
  none: "None",
};

/** Overlays whose colour mapping isn't self-evident carry a hover/focus legend. */
type LegendKind = "price" | "tradeFlow" | "logistics" | "routes";

interface OverlayDef {
  key: MapOverlayKey;
  label: string;
  /** CSS swatch colour — matches the glyph element this overlay paints. */
  swatch: string;
  /** Optional legend, shown in a tooltip on hover/focus (no permanent height). */
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
  { key: "logistics", label: "Logistics", swatch: pixiHexToCss(TIER_COLOR[1]), legend: "logistics" },
  { key: "shipRoutes", label: "Ship Routes", swatch: "#38bdf8", legend: "routes" },
];

const TERRITORY_OPTIONS = MAP_MODES.map((m) => ({
  value: m,
  label: MODE_LABELS[m],
  // Stability's tint→meaning mapping isn't self-evident, so carry a hover/focus
  // legend in a tooltip — matching the Overlays section, no permanent height.
  tooltip: m === "stability" ? <StabilityRampLegend /> : undefined,
}));

interface MapOverlayControlsProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
}

/**
 * The primary map control panel — Territory (single-select tint) over Overlays
 * (multi-select additive layers), built from the shared accessible form
 * controls (`RadioGroup` / `CheckboxInput`) so the two read as one family:
 * label left, indicator right (round radio vs square colour-coded checkbox).
 * Positioning is owned by the parent dock ([map-controls-dock.tsx]); the Price
 * good-picker lives in its own floating panel so it can't reflow this one.
 *
 * Foundry theme: sharp corners, surface background, copper accent on the active
 * row. Legends live in Radix tooltips (hover + keyboard focus) so the panel
 * stays compact and the legend is keyboard-accessible.
 */
export function MapOverlayControls({
  mode,
  setMode,
  overlays,
  toggle,
}: MapOverlayControlsProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
            Map
          </h3>
        </div>

        <SectionHeading>Mode</SectionHeading>
        <RadioGroup
          ariaLabel="Mode"
          name="mapMode"
          value={mode}
          onChange={setMode}
          options={TERRITORY_OPTIONS}
        />

        <div className="border-t border-border" />
        <SectionHeading>Overlays</SectionHeading>
        <div role="group" aria-label="Map overlays">
          {OVERLAY_DEFS.map(({ key, label, swatch, legend }) => {
            const checkbox = (
              <CheckboxInput
                label={label}
                checked={overlays[key]}
                onChange={() => toggle(key)}
                color={swatch}
              />
            );
            if (!legend) return <div key={key}>{checkbox}</div>;
            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>{checkbox}</TooltipTrigger>
                <TooltipContent side="right">
                  <OverlayLegend kind={legend} />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
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

/** Legend body for a tooltip — the surrounding box is supplied by TooltipContent. */
function OverlayLegend({ kind }: { kind: LegendKind }) {
  if (kind === "price") return <PriceRampLegend />;
  if (kind === "tradeFlow") return <TradeFlowLegend />;
  if (kind === "logistics") return <LogisticsLegend />;
  return (
    <p className="text-[10px] leading-relaxed text-text-secondary">
      Every in-transit ship&apos;s route. Markers stay visible at all zooms —
      hover one for its ETA, click to pin its route.
    </p>
  );
}

const PRICE_RAMP = [
  PRICE_RAMP_STOPS.deepBargain,
  PRICE_RAMP_STOPS.bargain,
  PRICE_RAMP_STOPS.neutral,
  PRICE_RAMP_STOPS.premium,
  PRICE_RAMP_STOPS.deepPremium,
].join(", ");

function PriceRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Price vs Base
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: `linear-gradient(to right, ${PRICE_RAMP})` }}
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

const STABILITY_RAMP = [
  STABILITY_RAMP_STOPS.Stable,
  STABILITY_RAMP_STOPS.Calm,
  STABILITY_RAMP_STOPS.Tense,
  STABILITY_RAMP_STOPS.Unrest,
  STABILITY_RAMP_STOPS.Strike,
].join(", ");

function StabilityRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Stability
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: `linear-gradient(to right, ${STABILITY_RAMP})` }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>Stable</span>
        <span>Strike</span>
      </div>
    </div>
  );
}

function TierSwatchList() {
  const tiers = [0, 1, 2] as const;
  return (
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
  );
}

function TradeFlowLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Good Tier
      </h5>
      <TierSwatchList />
    </div>
  );
}

function LogisticsLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Directed Logistics
      </h5>
      <TierSwatchList />
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Curved arc = a faction haul across systems; the arrow points to the
        importing system. Straight dots are market diffusion.
      </p>
    </div>
  );
}
