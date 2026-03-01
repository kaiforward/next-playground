import type { EVENT_DEFINITIONS } from "./events";
import type { MissionType } from "./missions";
import type { EnemyTier } from "./combat";
import type { NotificationType } from "@/lib/types/game";

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

/** Mapping from notification/event type to toast/badge accent color. */
export const NOTIFICATION_BADGE_COLOR: Record<
  NotificationType | keyof typeof EVENT_DEFINITIONS,
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
  ship_damaged: "amber",
  ship_disabled: "red",
  cargo_lost: "red",
  hazard_incident: "amber",
  import_duty: "slate",
  contraband_seized: "red",
  mission_completed: "green",
  mission_expired: "amber",
  battle_round: "purple",
  battle_won: "green",
  battle_lost: "red",
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

/** Mapping from mission type to Badge color. */
export const MISSION_TYPE_BADGE_COLOR: Record<
  MissionType,
  "red" | "cyan" | "purple" | "amber" | "green"
> = {
  patrol: "red",
  survey: "cyan",
  bounty: "purple",
  salvage: "amber",
  recon: "green",
};

/** Mapping from enemy tier to Badge color. */
export const ENEMY_TIER_BADGE_COLOR: Record<
  EnemyTier,
  "green" | "amber" | "red"
> = {
  weak: "green",
  moderate: "amber",
  strong: "red",
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

// ── Chart theme ──────────────────────────────────────────────

export const CHART_THEME = {
  gridStroke: "#333",
  axisStroke: "#666",
  tickFill: "#999",
  tickFontSize: 12,
  legendColor: "#999",
  tooltipBg: "#1a1a2e",
  tooltipBorder: "rgba(255,255,255,0.1)",
  tooltipBorderRadius: "8px",
  tooltipTextColor: "#fff",
  tooltipLabelColor: "#999",
} as const;

// ── Good colors (for charts) ─────────────────────────────────

import { GOODS } from "./goods";

/** Pie/bar chart fill color per good slug. */
export const GOOD_COLORS: Record<string, string> = {
  water: "#60a5fa",
  food: "#4ade80",
  ore: "#d97706",
  textiles: "#c084fc",
  fuel: "#f97316",
  metals: "#94a3b8",
  chemicals: "#22d3ee",
  medicine: "#f472b6",
  electronics: "#818cf8",
  machinery: "#a8a29e",
  weapons: "#ef4444",
  luxuries: "#fbbf24",
};

/** Reverse map: display name → slug key (e.g. "Water" → "water"). */
const GOOD_NAME_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(GOODS).map(([slug, def]) => [def.name, slug]),
);

/** Resolve a chart color for a good by display name. */
export function getGoodColor(goodName: string): string {
  const slug = GOOD_NAME_TO_SLUG[goodName];
  return slug ? (GOOD_COLORS[slug] ?? "#6b7280") : "#6b7280";
}

