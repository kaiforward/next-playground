"use client";

import { MAP_MODES, type MapMode } from "@/lib/types/map";
import {
  rampCssStops, ABSENT_CSS, provisionLegendStops, lanesLegendStops,
  type ContinuousMode, type SteppedLegendStop,
} from "@/components/map/pixi/value-ramp";
import { LANE_BANDS } from "@/components/map/pixi/objects/lane-band";
import { RadioGroup } from "@/components/form/radio-group";

const MODE_LABELS: Record<MapMode, string> = {
  political: "Political",
  regions: "Regions",
  stability: "Stability",
  population: "Population",
  development: "Development",
  migration: "Migration",
  provision: "Provisioned",
  lanes: "Lanes",
  none: "None",
};

const TERRITORY_OPTIONS = MAP_MODES.map((m) => ({
  value: m,
  label: MODE_LABELS[m],
  // Stability/Population tint→meaning mappings aren't self-evident, so carry a
  // hover/focus legend in a tooltip, no permanent height.
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
    ) : m === "lanes" ? (
      <LanesLegend />
    ) : undefined,
}));

interface MapOverlayControlsProps {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
}

/**
 * The primary map control panel — a single Mode section (single-select tint,
 * now including Lanes) built from the shared accessible `RadioGroup` control.
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
}: MapOverlayControlsProps) {
  return (
    <div className="w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
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
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="px-3 pt-2 pb-1">
      <h4 className="text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        {children}
      </h4>
    </div>
  );
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
      <h5 className="mb-1 text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Stability
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("stability") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-xs font-mono text-text-secondary">
        <span>Unstable</span>
        <span>Stable</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Higher = calmer. Black = out of sensor range.
      </p>
    </div>
  );
}

function PopulationRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Population
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("population") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-xs font-mono text-text-secondary">
        <span>None</span>
        <span>Highest</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Relative to the most populous system you can currently see. Black = none.
      </p>
    </div>
  );
}

function DevelopmentRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Development
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("development") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-xs font-mono text-text-secondary">
        <span>Frontier</span>
        <span>Built-out</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Population + industry a system has built and worked, measured against the galaxy&rsquo;s biggest. Black = none.
      </p>
    </div>
  );
}

function MigrationRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Migration
      </h5>
      <div
        className="h-2 w-full"
        style={{ background: rampGradient("migration") }}
        aria-hidden
      />
      <div className="mt-0.5 flex justify-between text-xs font-mono text-text-secondary">
        <span>Crowded</span>
        <span>Attractive</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Where population is drawn — room, jobs and calm. Black = undeveloped or out of sensor range.
      </p>
    </div>
  );
}

/**
 * One flat swatch per stepped-legend band, sized to the real span between each stop's position and
 * the next (the last band runs to `domainEnd`) — so the legend's boundaries sit at the fill's own
 * band edges rather than at even fractions. Shared by every stepped value mode (unlike the other
 * value modes' `rampGradient`, a smooth CSS gradient built from `rampCssStops`, which discards stop
 * positions and so can't render a legend like this one).
 */
function SteppedSwatchRow({ stops, domainEnd }: { stops: SteppedLegendStop[]; domainEnd: number }) {
  return (
    <div className="flex h-2 w-full" aria-hidden>
      {stops.map((stop, i) => {
        const end = i + 1 < stops.length ? stops[i + 1].position : domainEnd;
        const width = ((end - stop.position) / domainEnd) * 100;
        return <span key={stop.position} style={{ background: stop.css, width: `${width}%` }} />;
      })}
    </div>
  );
}

function ProvisionRampLegend() {
  return (
    <div>
      <h5 className="mb-1 text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Provisioned
      </h5>
      <SteppedSwatchRow stops={provisionLegendStops()} domainEnd={1} />
      <div className="mt-0.5 flex justify-between text-xs font-mono text-text-secondary">
        <span>Deprived</span>
        <span>Supplied</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Share of the civilian basket delivered — stepped at the Deprived / Rationing / Strained /
        Supplied band edges, not a smooth gradient. Famine is a separate reading and paints no band
        here. Black = never assessed.
      </p>
    </div>
  );
}

/**
 * Stepped legend for the Lanes map mode: fine / busy / congested, evenly thirded (there is no real
 * span to size by, unlike Provisioned's percentage edges — see `lanesLegendStops`). The two lines
 * below the swatch cover the two states the fill/width alone can't show: a dashed lane has no
 * investor, and a pulsing lane is congested this run.
 */
function LanesLegend() {
  return (
    <div>
      <h5 className="mb-1 text-xs font-display font-bold uppercase tracking-[0.18em] text-text-tertiary">
        Lanes
      </h5>
      <SteppedSwatchRow stops={lanesLegendStops()} domainEnd={LANE_BANDS.length} />
      <div className="mt-0.5 flex justify-between text-xs font-mono text-text-secondary">
        <span>Fine</span>
        <span>Busy</span>
        <span>Congested</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Coloured by the faction investing in the lane, wider at a higher lane level. Dashed means
        no investor. A pulsing lane is congested — it turned volume away this run.
      </p>
    </div>
  );
}

