// ── Map-view types shared between hooks, components, and the Pixi canvas ──

/** Single-select tint applied to the territory polygons. `none` hides both. */
export type MapMode = "political" | "regions" | "stability" | "population" | "development" | "none";

/** Iteration order also defines the UI render order in the Mode toggle group. */
export const MAP_MODES: readonly MapMode[] = ["political", "regions", "stability", "population", "development", "none"];

const MAP_MODE_SET: ReadonlySet<string> = new Set<MapMode>(MAP_MODES);

/** Narrows an unknown string to `MapMode` for sessionStorage hydration. */
export function isMapMode(value: unknown): value is MapMode {
  return typeof value === "string" && MAP_MODE_SET.has(value);
}

/** True for the modes that drive the value choropleth (population/stability/development). */
export function isValueMapMode(mode: MapMode): boolean {
  return mode === "population" || mode === "stability" || mode === "development";
}

/**
 * True for the modes where a zoomed-out click/hover targets a FACTION: political (opens the faction
 * panel) and the value modes (also re-scope the gradient to it). `regions` and `none` show no faction
 * territory, so faction targeting is excluded there — a zoomed-out click falls through to selecting the
 * individual cell/system, exactly as it does zoomed in.
 */
export function isFactionInteractiveMode(mode: MapMode): boolean {
  return mode === "political" || isValueMapMode(mode);
}
