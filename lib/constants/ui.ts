import type { EVENT_DEFINITIONS, EventTypeId } from "./events";
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

/** The alert bar's three event chips — authored valence per event type, decided
 *  at design time rather than computed from a merged chip's worst member. */
export type EventBand = "crisis" | "disruption" | "windfall";

/**
 * Band and within-band impact rank per event type, beside `EVENT_TYPE_ICON` and
 * keyed the same way so the compiler requires all seventeen types.
 *
 * `EventDefinition` carries no severity field (`weight` is spawn frequency, not
 * severity) and `WorldEvent.severity` is a spread-weakening intensity identical
 * across every root event, so neither band nor rank is a read of existing data
 * — both are authored here.
 *
 * `impactRank` is the within-band sort for `crisis` and `disruption`: **lower
 * ranks first, i.e. rank 1 is the most severe** within its band. It is authored
 * from each type's actual phase modifiers in `./events` — the floor production
 * multiplier, its duration, whether it hits a survival good, and whether it is
 * system-wide (`goodId: null`) or narrow. `windfall` sorts by `ticksRemaining`
 * instead (which exists on the event instance), so its `impactRank` is present
 * only for type uniformity and carries no order — every windfall type is 0.
 */
export const EVENT_BAND: Record<
  EventTypeId,
  { band: EventBand; impactRank: number }
> = {
  // Crisis — events that can break a world. Ranked by production-rate floor,
  // how long that floor holds, and whether it targets a survival good.
  plague: { band: "crisis", impactRank: 1 }, // food production to 0.1-0.15 for up to ~120 ticks, plus an 80%/50% food supply shock — a survival good, sustained.
  asteroid_strike: { band: "crisis", impactRank: 2 }, // system-wide production to 0.05, plus 70%/50% ore/fuel supply shocks — the deepest floor, but only 10-20 ticks before recovery begins.
  inner_system_conflict: { band: "crisis", impactRank: 3 }, // system-wide production to 0.2 for 80-150 ticks, the longest active phase of any crisis type.
  pirate_raid: { band: "crisis", impactRank: 4 }, // no production-rate modifier at all — demand shifts and a single 25% electronics supply shock.
  border_conflict: { band: "crisis", impactRank: 5 }, // mildest of the band: production to 0.9 (a 10% cut) in one phase, otherwise no modifiers.

  // Disruption — events that cost but do not threaten. Same ranking method.
  solar_storm: { band: "disruption", impactRank: 1 }, // system-wide production to 0.05, matching asteroid_strike's floor, over 25-50 ticks.
  trade_embargo: { band: "disruption", impactRank: 2 }, // system-wide production to 0.5-0.7 sustained up to 120 ticks, plus 50%/50% electronics/machinery supply shocks.
  supply_shortage: { band: "disruption", impactRank: 3 }, // no production cut, but a 50%/50% food/fuel supply shock — food is a survival good.
  refugee_crisis: { band: "disruption", impactRank: 4 }, // up to 180 ticks of demand pressure on food and medicine, a 30% food supply shock, only a mild 0.7 production dip.
  plague_risk: { band: "disruption", impactRank: 5 }, // food production to 0.6 for one 30-60 tick phase — real but narrower and shorter than the ranks above.
  conflict_spillover: { band: "disruption", impactRank: 6 }, // production to 0.8 (a 20% cut) for one phase — the weakened child of inner_system_conflict.
  ore_glut: { band: "disruption", impactRank: 7 }, // a single demand-side anchor shift, no production or supply effect at all.
  alliance_dissolved: { band: "disruption", impactRank: 8 }, // no modifiers of any kind — a political signal with zero economic effect.

  // Windfall — events worth riding. Sorted by ticksRemaining elsewhere, so
  // impactRank carries no order here; every entry is 0 for type uniformity.
  trade_festival: { band: "windfall", impactRank: 0 },
  mining_boom: { band: "windfall", impactRank: 0 },
  tech_breakthrough: { band: "windfall", impactRank: 0 },
  pact_under_negotiation: { band: "windfall", impactRank: 0 },
};

/** Band order, worst first. Not derivable from the union's declaration order — stated. */
const EVENT_BAND_ORDER: Record<EventBand, number> = { crisis: 0, disruption: 1, windfall: 2 };

/**
 * The one severity ordering over event types, worst first: band before rank, and inside a band the
 * lower `impactRank` first. Every surface that ranks events by how bad they are sorts through this,
 * so a second scale cannot drift away from the authored one — which is exactly what happened before,
 * when a separate hand-numbered priority disagreed with the bands about whether a plague or a solar
 * storm was worse. Windfall types all carry rank 0 and therefore tie; they sort by `ticksRemaining`
 * wherever that matters.
 */
export function compareEventSeverity(a: EventTypeId, b: EventTypeId): number {
  const left = EVENT_BAND[a];
  const right = EVENT_BAND[b];
  const byBand = EVENT_BAND_ORDER[left.band] - EVENT_BAND_ORDER[right.band];
  return byBand !== 0 ? byBand : left.impactRank - right.impactRank;
}

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

