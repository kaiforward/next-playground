"use client";

import { computeLOD, type LODState } from "./pixi/lod";

/**
 * Dev-only overlay printing the live camera zoom and the LOD state derived from
 * it — every element's visibility gate and fade alpha at the current zoom.
 * Purpose-built for tuning the thresholds and ramps in `pixi/lod.ts`: read a
 * value here, then adjust the matching `LAYER_FADE` entry / smoothStep band.
 *
 * Toggled via Dev Tools → Map (off by default). Temporary tuning scaffolding —
 * safe to delete once the zoom bands are dialled in.
 */

interface DebugRow {
  label: string;
  /** Alpha (2dp), scale, or "ON"/"off". */
  value: string;
  /** Whether the element contributes anything visible at this zoom. */
  active: boolean;
}

const a2 = (n: number) => n.toFixed(2);
const VISIBLE = 0.001;

function buildRows(lod: LODState): DebugRow[] {
  return [
    { label: "point cloud", value: a2(lod.pointCloudAlpha), active: lod.pointCloudAlpha > VISIBLE },
    { label: "system layer", value: a2(lod.systemLayerAlpha), active: lod.systemLayerAlpha > VISIBLE },
    { label: "objects active", value: lod.systemObjectsActive ? "ON" : "off", active: lod.systemObjectsActive },
    { label: "dot scale", value: a2(lod.systemDotScale), active: true },
    {
      label: "system names",
      value: lod.showSystemNames ? a2(lod.systemNameAlpha) : "off",
      active: lod.showSystemNames && lod.systemNameAlpha > VISIBLE,
    },
    {
      label: "econ labels",
      value: lod.showEconomyLabels ? a2(lod.detailAlpha) : "off",
      active: lod.showEconomyLabels && lod.detailAlpha > VISIBLE,
    },
    { label: "territory (regions)", value: a2(lod.territoryAlpha), active: lod.territoryAlpha > VISIBLE },
    { label: "territory (political)", value: a2(lod.politicalTerritoryAlpha), active: lod.politicalTerritoryAlpha > VISIBLE },
    {
      label: "region labels",
      value: lod.showRegionLabels ? a2(lod.regionLabelAlpha) : "off",
      active: lod.showRegionLabels && lod.regionLabelAlpha > VISIBLE,
    },
    { label: "logistics", value: a2(lod.logisticsAlpha), active: lod.logisticsAlpha > VISIBLE },
    { label: "glow", value: lod.showGlow ? "ON" : "off", active: lod.showGlow },
    {
      label: "pill content",
      value: lod.showPillContent ? a2(lod.pillContentAlpha) : "off",
      active: lod.showPillContent && lod.pillContentAlpha > VISIBLE,
    },
  ];
}

export function MapZoomDebug({ zoom }: { zoom: number }) {
  const lod = computeLOD(zoom);
  const rows = buildRows(lod);

  return (
    <div className="pointer-events-none absolute top-4 right-4 z-50 w-52 select-none border border-border bg-gray-950/85 px-3 py-2 font-mono text-[10px] leading-tight text-text-secondary backdrop-blur">
      <div className="mb-1.5 flex items-baseline justify-between border-b border-border pb-1">
        <span className="uppercase tracking-wider text-text-tertiary">zoom</span>
        <span className="text-base font-bold tabular-nums text-accent">{zoom.toFixed(3)}</span>
      </div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-text-tertiary">tier</span>
        <span className="uppercase text-text-primary">{lod.viewTier}</span>
      </div>
      <dl className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <dt className={row.active ? "text-text-secondary" : "text-text-tertiary/40"}>{row.label}</dt>
            <dd className={`tabular-nums ${row.active ? "text-text-primary" : "text-text-tertiary/40"}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
