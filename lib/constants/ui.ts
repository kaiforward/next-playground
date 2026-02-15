import type { EconomyType, RegionIdentity } from "@/lib/types/game";
import type { EVENT_DEFINITIONS } from "./events";

/** Mapping from economy type to Badge color prop. */
export const ECONOMY_BADGE_COLOR: Record<
  EconomyType,
  "green" | "amber" | "blue" | "purple" | "slate" | "red" | "cyan"
> = {
  agricultural: "green",
  extraction: "amber",
  refinery: "cyan",
  industrial: "slate",
  tech: "blue",
  core: "purple",
};

/** Mapping from event type to Badge/dot color. */
export const EVENT_TYPE_BADGE_COLOR: Record<
  keyof typeof EVENT_DEFINITIONS,
  "red" | "amber" | "purple" | "green" | "blue" | "slate"
> = {
  war: "red",
  plague: "amber",
  trade_festival: "purple",
  conflict_spillover: "red",
  plague_risk: "amber",
  mining_boom: "green",
  ore_glut: "green",
  supply_shortage: "amber",
  pirate_raid: "red",
  solar_storm: "blue",
};

/** Mapping from notification type to toast/badge accent color. */
export const NOTIFICATION_BADGE_COLOR: Record<
  string,
  "red" | "amber" | "purple" | "green" | "blue" | "slate"
> = {
  war: "red",
  plague: "amber",
  trade_festival: "purple",
  conflict_spillover: "red",
  plague_risk: "amber",
  mining_boom: "green",
  ore_glut: "green",
  supply_shortage: "amber",
  pirate_raid: "red",
  solar_storm: "blue",
  ship_arrived: "blue",
  cargo_lost: "red",
  hazard_incident: "amber",
  import_duty: "slate",
  contraband_seized: "red",
};

/**
 * Danger priority per event type — higher = more dangerous.
 * Used to pick the "dominant" event for border/glow when multiple events affect one system.
 */
export const EVENT_TYPE_DANGER_PRIORITY: Record<
  keyof typeof EVENT_DEFINITIONS,
  number
> = {
  trade_festival: 1,
  mining_boom: 2,
  ore_glut: 3,
  plague_risk: 4,
  supply_shortage: 5,
  conflict_spillover: 6,
  plague: 7,
  pirate_raid: 8,
  solar_storm: 9,
  war: 10,
};

/** Icon key per event type, consumed by EventIcon component. */
export const EVENT_TYPE_ICON: Record<
  keyof typeof EVENT_DEFINITIONS,
  string
> = {
  war: "sword",
  plague: "virus",
  trade_festival: "sparkles",
  conflict_spillover: "explosion",
  plague_risk: "biohazard",
  mining_boom: "pickaxe",
  ore_glut: "cubes",
  supply_shortage: "package-x",
  pirate_raid: "skull",
  solar_storm: "bolt",
};

/** Mapping from region identity to Badge color prop. */
export const REGION_IDENTITY_BADGE_COLOR: Record<
  RegionIdentity,
  "green" | "amber" | "blue" | "purple" | "slate"
> = {
  resource_rich: "amber",
  agricultural: "green",
  industrial: "slate",
  tech: "blue",
  trade_hub: "purple",
};
