import type { EVENT_DEFINITIONS } from "./events";
import type { SunClass, QualityBandId, TaxLevel } from "@/lib/types/game";

// ── Deposit quality bands ────────────────────────────────────
// A dull→warm value ramp for deposit grades. Copper (text-accent) marks the
// richest tier — the signature Foundry accent; green is deliberately avoided
// since it already denotes "habitable" on body cards.

/** Capitalised band label. */
export const QUALITY_BAND_LABEL: Record<QualityBandId, string> = {
  poor: "Poor", average: "Average", good: "Good", rich: "Rich",
};
/** Text colour class per band. */
export const QUALITY_BAND_TEXT: Record<QualityBandId, string> = {
  poor: "text-status-slate-light",
  average: "text-text-secondary",
  good: "text-status-amber-light",
  rich: "text-text-accent",
};
/** Dot/swatch background colour class per band. */
export const QUALITY_BAND_DOT: Record<QualityBandId, string> = {
  poor: "bg-status-slate",
  average: "bg-text-secondary",
  good: "bg-status-amber",
  rich: "bg-text-accent",
};

// ── Labour grade colors ──────────────────────────────────────
// Distinct from health and from land (copper). Shared by the Industry panel's
// staffing bars and the system-detail Population vital tile's composition bar
// — `bar`/`text` are Tailwind utility classes, `color` is the same hue as a
// raw CSS value for contexts (e.g. inline `style`) that can't take a class.

export type LabourGrade = "unskilled" | "skill1" | "skill2";

export const GRADE: Record<LabourGrade, { bar: string; text: string; color: string; tag: string; name: string }> = {
  unskilled: { bar: "bg-status-blue", text: "text-status-blue-light", color: "var(--color-status-blue)", tag: "U", name: "Unskilled" },
  skill1: { bar: "bg-status-cyan", text: "text-status-cyan-light", color: "var(--color-status-cyan)", tag: "T", name: "Technicians" },
  skill2: { bar: "bg-status-purple", text: "text-status-purple-light", color: "var(--color-status-purple)", tag: "E", name: "Engineers" },
};

/** Mapping from event type to Badge/dot color. */
export const EVENT_TYPE_BADGE_COLOR: Record<
  keyof typeof EVENT_DEFINITIONS,
  "red" | "amber" | "purple" | "green" | "blue" | "slate"
> = {
  inner_system_conflict: "red",
  plague: "amber",
  trade_festival: "purple",
  conflict_spillover: "red",
  plague_risk: "amber",
  mining_boom: "green",
  ore_glut: "green",
  supply_shortage: "amber",
  pirate_raid: "red",
  solar_storm: "blue",
  refugee_crisis: "amber",
  trade_embargo: "purple",
  tech_breakthrough: "green",
  asteroid_strike: "red",
  border_conflict: "red",
  pact_under_negotiation: "purple",
  alliance_dissolved: "amber",
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
  tech_breakthrough: 2,
  mining_boom: 3,
  ore_glut: 4,
  plague_risk: 5,
  supply_shortage: 6,
  refugee_crisis: 7,
  trade_embargo: 8,
  conflict_spillover: 9,
  plague: 10,
  pirate_raid: 11,
  solar_storm: 12,
  asteroid_strike: 13,
  inner_system_conflict: 14,
  // Diplomatic events: informational only, no danger contribution.
  pact_under_negotiation: 0,
  alliance_dissolved: 0,
  // Border conflict ranks between conflict_spillover and plague.
  border_conflict: 10,
};

import type { LucideIcon } from "lucide-react";
import {
  Swords,
  Biohazard,
  Sparkles,
  Bomb,
  TriangleAlert,
  Pickaxe,
  Boxes,
  PackageX,
  Skull,
  Zap,
  Users,
  ShieldBan,
  Lightbulb,
  Flame,
  Crosshair,
  Handshake,
  HeartCrack,
} from "lucide-react";

/** Lucide icon component per event type, consumed by EventIcon component. */
export const EVENT_TYPE_ICON: Record<
  keyof typeof EVENT_DEFINITIONS,
  LucideIcon
> = {
  inner_system_conflict: Swords,
  plague: Biohazard,
  trade_festival: Sparkles,
  conflict_spillover: Bomb,
  plague_risk: TriangleAlert,
  mining_boom: Pickaxe,
  ore_glut: Boxes,
  supply_shortage: PackageX,
  pirate_raid: Skull,
  solar_storm: Zap,
  refugee_crisis: Users,
  trade_embargo: ShieldBan,
  tech_breakthrough: Lightbulb,
  asteroid_strike: Flame,
  border_conflict: Crosshair,
  pact_under_negotiation: Handshake,
  alliance_dissolved: HeartCrack,
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

// ── Sun class colors (for star glyphs) ───────────────────────

/** Star-glyph swatch color per sun class (presentation only; the display label
 *  comes from the SUN_CLASSES catalog). */
export const SUN_CLASS_COLORS: Record<SunClass, string> = {
  yellow: "#facc15",
  blue_white: "#93c5fd",
  orange_dwarf: "#fb923c",
  red_dwarf: "#f87171",
};

// ── Good colors (for charts) ─────────────────────────────────

import { GOODS } from "./goods";

/** Pie/bar chart fill color per good slug. */
export const GOOD_COLORS: Record<string, string> = {
  water: "#60a5fa",
  food: "#4ade80",
  ore: "#d97706",
  textiles: "#c084fc",
  gas: "#a5f3fc",
  minerals: "#fcd34d",
  biomass: "#86efac",
  radioactives: "#bef264",
  fuel: "#f97316",
  metals: "#94a3b8",
  chemicals: "#22d3ee",
  medicine: "#f472b6",
  alloys: "#cbd5e1",
  polymers: "#f0abfc",
  components: "#93c5fd",
  consumer_goods: "#fda4af",
  munitions: "#fb7185",
  hull_plating: "#78716c",
  electronics: "#818cf8",
  machinery: "#a8a29e",
  weapons: "#ef4444",
  luxuries: "#fbbf24",
  weapons_systems: "#dc2626",
  targeting_arrays: "#2dd4bf",
  reactor_cores: "#facc15",
  ship_frames: "#64748b",
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

// ── Faction tax stance ───────────────────────────────────────

/** Display names for the five-step faction tax stance. */
export const TAX_LEVEL_LABELS: Record<TaxLevel, string> = {
  very_low: "Very low",
  low: "Low",
  normal: "Normal",
  high: "High",
  very_high: "Very high",
};

