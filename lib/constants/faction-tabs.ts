/** Canonical list of faction-panel tabs, in display order. Mirrors the system-panel tab pattern
 * (`@panel/factions/[factionId]/layout.tsx` drives them) so the faction screen reads like a country
 * panel: Overview (aggregate vitals + identity), Diplomacy (relations), Territory (system list). */
export const FACTION_TABS = [
  { label: "Overview", segment: "" },
  { label: "Diplomacy", segment: "diplomacy" },
  { label: "Territory", segment: "territory" },
] as const;

export type FactionTab = (typeof FACTION_TABS)[number];
/** Path segment appended after `/factions/<id>`. Empty string = the Overview base path. */
export type FactionTabSegment = FactionTab["segment"];
