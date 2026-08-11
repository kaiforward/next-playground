"use client";

import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import { MAP_MODES, type MapMode } from "@/lib/types/map";
import type { MapOverlayKey, MapOverlays } from "@/lib/hooks/use-map-overlays";
import {
  rampCssStops, ABSENT_CSS, provisionLegendStops, type ContinuousMode,
} from "@/components/map/pixi/value-ramp";
import { RadioGroup } from "@/components/form/radio-group";
import { CheckboxInput } from "@/components/form/checkbox-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  stability: "Stability",
  population: "Population",
  development: "Development",
  migration: "Migration",
  provision: "Provisioned",
  none: "None",
};

/** Overlays whose colour mapping isn't self-evident carry a hover/focus legend. */
type LegendKind = "logistics";

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
  { key: "logistics", label: "Logistics", swatch: pixiHexToCss(TIER_COLOR[1]), legend: "logistics" },
];

const TERRITORY_OPTIONS = MAP_MODES.map((m) => ({
  value: m,
  label: MODE_LABELS[m],
  // Stability/Population tint→meaning mappings aren't self-evident, so carry a
  // hover/focus legend in a tooltip — matching the Overlays section, no
  // permanent height.
  tooltip:
    m === "stability" ? (
      <StabilityRampLegend />
    ) : m === "population" ? (
      <PopulationRampLegend />
    ) : m === "development" ? (
      <DevelopmentRampLegend />
    ) : m === "migration" ? (
      <MigrationRampLegend />
    ) : m === "provision" ? (
      <ProvisionRampLegend />
    ) : undefined,
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
  if (kind === "logistics") return <LogisticsLegend />;
  return null;
}

/**
 * Legend gradient = black (absent / value 0) then the mode's present-value ramp.
 * Rendered from the SAME `value-ramp` stops the Pixi cells are filled from, so
 * the legend swatch can never drift from the map (one source of truth).
 */
function rampGradient(mode: ContinuousMode): string {
  return `linear-gradient(to right, ${[ABSENT_CSS, ...rampCssStops(mode)].join(", ")})`;
}

function StabilityRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Stability
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("stability") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>Unstable</span>
        <span>Stable</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Higher = calmer. Black = out of sensor range.
      </p>
    </div>
  );
}

function PopulationRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Population
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("population") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>None</span>
        <span>Highest</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Relative to the most populous system you can currently see. Black = none.
      </p>
    </div>
  );
}

function DevelopmentRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Development
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("development") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>Frontier</span>
        <span>Built-out</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Population + industry a system has built and worked, measured against the galaxy&rsquo;s biggest. Black = none.
      </p>
    </div>
  );
}

function MigrationRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Migration
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("migration") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>Crowded</span>
        <span>Attractive</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Where population is drawn — room, jobs and calm. Black = undeveloped or out of sensor range.
      </p>
    </div>
  );
}

/**
 * Stepped legend: unlike the other value modes' `rampGradient` (a smooth CSS gradient built from
 * `rampCssStops`, which discards stop positions), this renders one flat swatch per band, sized to
 * the real span between `provisionLegendStops` positions — so the legend's boundaries sit at the
 * band edges (DEPRIVED_PROVISION, RATIONING_PROVISION, SUPPLIED_PROVISION), not at even quarters.
 */
function ProvisionRampLegend() {
  const stops = provisionLegendStops();
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Provisioned
      </h5>
      <div className="flex h-2 w-full" aria-hidden>
        {stops.map((stop, i) => {
          const end = i + 1 < stops.length ? stops[i + 1].position : 1;
          const width = (end - stop.position) * 100;
          return <span key={stop.position} style={{ background: stop.css, width: `${width}%` }} />;
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] font-mono text-text-secondary">
        <span>Deprived</span>
        <span>Supplied</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Share of the civilian basket delivered — stepped at the Deprived / Rationing / Strained /
        Supplied band edges, not a smooth gradient. Famine is a separate reading and paints no band
        here. Black = never assessed.
      </p>
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

function LogisticsLegend() {
  return (
    <div>
      <h5 className="mb-1 text-[9px] font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Directed Logistics
      </h5>
      <TierSwatchList />
      <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">
        Curved arc = a faction haul across systems; the arrow points to the
        importing system.
      </p>
    </div>
  );
}
