/** Canonical list of faction-panel tabs, in display order. Mirrors the system-panel tab pattern
 * (`@panel/factions/[factionId]/layout.tsx` drives them). The first three are about THIS faction:
 * Overview (aggregate vitals + identity), Diplomacy (relations, plus the galaxy-wide matrix),
 * Territory (system list). The last two are galaxy-level surfaces that live here because the
 * faction panel is their nearest home — Factions (every power in the galaxy) and Events (the
 * active-events feed) — reachable from any faction's panel, not just the player's. */
export const FACTION_TABS = [
  { label: "Overview", segment: "" },
  { label: "Diplomacy", segment: "diplomacy" },
  { label: "Territory", segment: "territory" },
  { label: "Factions", segment: "factions" },
  { label: "Events", segment: "events" },
] as const;

export type FactionTab = (typeof FACTION_TABS)[number];
/** Path segment appended after `/factions/<id>`. Empty string = the Overview base path. */
export type FactionTabSegment = FactionTab["segment"];
