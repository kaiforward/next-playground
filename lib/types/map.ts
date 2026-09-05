// ── Map-view types shared between hooks, components, and the Pixi canvas ──

/** Single-select tint applied to the territory polygons. `none` hides both. */
export type MapMode =
  | "political" | "regions" | "stability" | "population" | "development"
  | "migration" | "provision" | "lanes"
  | "none";

/** Iteration order also defines the UI render order in the Mode toggle group. */
export const MAP_MODES: readonly MapMode[] = [
  "political", "regions", "stability", "population", "development", "migration", "provision", "lanes", "none",
];

const MAP_MODE_SET: ReadonlySet<string> = new Set<MapMode>(MAP_MODES);

/** Narrows an unknown string to `MapMode` for sessionStorage hydration. */
export function isMapMode(value: unknown): value is MapMode {
  return typeof value === "string" && MAP_MODE_SET.has(value);
}

/** True for the modes that drive the value choropleth (population/stability/development/migration/
 *  provision/lanes). */
export function isValueMapMode(mode: MapMode): boolean {
  return (
    mode === "population" || mode === "stability" || mode === "development" ||
    mode === "migration" || mode === "provision" || mode === "lanes"
  );
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

/** The settlement mark drawn at a player system's star: hollow slate = claimed, hollow amber with a
 *  pulse = colony forming, solid copper = developed. `null` = no mark (foreign or unclaimed). */
export type SettlementMark = "controlled" | "forming" | "developed";

/**
 * Which settlement mark a system carries, from its live ownership reading. Marks are player-only
 * for now — the point is running your own colonisation — so any other faction's system returns
 * null; widening to all factions is a change to this one gate. `developed` wins over a stale
 * `forming` pairing (they never co-occur in real data: a forming site is `controlled`).
 */
export function settlementMarkFor(
  own: { factionId: string | null; developed: boolean; forming: boolean } | undefined,
  playerFactionId: string | null,
): SettlementMark | null {
  if (own === undefined || playerFactionId === null || own.factionId !== playerFactionId) return null;
  if (own.developed) return "developed";
  return own.forming ? "forming" : "controlled";
}
