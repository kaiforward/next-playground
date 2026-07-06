/** Canonical list of system-panel tabs, in display order. Sourced by the full
 * system panel (`@panel/system/[systemId]/layout.tsx`) and the map's system
 * detail sidebar so the two can't drift out of sync. */
export const SYSTEM_TABS = [
  { label: "Overview", segment: "" },
  { label: "Astrography", segment: "astrography" },
  { label: "Population", segment: "population" },
  { label: "Industry", segment: "industry" },
  { label: "Logistics", segment: "logistics" },
  { label: "Market", segment: "market" },
  { label: "Ships", segment: "ships" },
  { label: "Convoys", segment: "convoys" },
  { label: "Shipyard", segment: "shipyard" },
  { label: "Explore", segment: "explore" },
] as const;

export type SystemTab = (typeof SYSTEM_TABS)[number];
/** Path segment appended after `/system/<id>`. Empty string = the Overview base path. */
export type SystemTabSegment = SystemTab["segment"];
