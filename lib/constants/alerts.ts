// Alert bar category registry — the spec's authored tier list in one place, so tier, default,
// destination and order cannot drift apart across the surfaces that read them.

import {
  WheatOff,
  Megaphone,
  BanknoteX,
  Siren,
  BatteryLow,
  TrendingUp,
  Hourglass,
  RouteOff,
  BedDouble,
  HardHat,
  Factory,
  TriangleAlert,
  Globe,
  Sparkles,
} from "lucide-react";
import type { AlertCategoryId, AlertCategoryDef } from "@/lib/types/alerts";
import type { BuildDropReason } from "@/lib/engine/directed-build";

/**
 * Tier, icon, default and destination per alert category — the authored table from the alert bar
 * spec's tier list, keyed so the compiler requires all sixteen. `order` is unique within a tier: the
 * authored order is total, so a chip cannot move once ranking runs.
 */
export const ALERT_CATEGORIES: Record<AlertCategoryId, AlertCategoryDef> = {
  // ── critical — cannot be turned off ──────────────────────────
  famine: {
    tier: "critical",
    icon: WheatOff,
    faulted: false,
    label: "Famine",
    conditionLine: "A world can't get enough food or water, and is losing population.",
    destination: { kind: "system", tab: "population" },
    defaultOn: true,
    hideable: false,
    order: 0,
  },
  strike: {
    tier: "critical",
    icon: Megaphone,
    faulted: false,
    label: "Strike",
    conditionLine: "Unrest has passed the point where workers walk out.",
    destination: { kind: "system", tab: "population" },
    defaultOn: true,
    hideable: false,
    order: 1,
  },
  maintenance_unfunded: {
    tier: "critical",
    icon: BanknoteX,
    faulted: false,
    label: "Maintenance unfunded",
    conditionLine: "The treasury couldn't pay for maintenance a settlement was asked to fund.",
    destination: { kind: "faction" },
    defaultOn: true,
    hideable: false,
    order: 2,
  },
  crisis: {
    tier: "critical",
    icon: Siren,
    faulted: false,
    label: "Crisis",
    conditionLine: "An event severe enough to threaten a world is underway.",
    destination: { kind: "events" },
    defaultOn: true,
    hideable: false,
    order: 3,
  },

  // ── important — three default off ────────────────────────────
  deprived_worlds: {
    tier: "important",
    icon: BatteryLow,
    faulted: false,
    label: "Deprived worlds",
    conditionLine: "Provision has fallen into the Deprived band.",
    destination: { kind: "system", tab: "population" },
    defaultOn: true,
    hideable: true,
    order: 0,
  },
  unrest_rising: {
    tier: "important",
    icon: TrendingUp,
    faulted: false,
    label: "Unrest rising",
    conditionLine: "Provision is below what the population expects, before anyone strikes.",
    destination: { kind: "system", tab: "population" },
    defaultOn: false,
    hideable: true,
    order: 1,
  },
  survival_stock_falling: {
    tier: "important",
    icon: Hourglass,
    faulted: false,
    label: "Survival stock falling",
    conditionLine: "A world's food or water reserve is only a few cycles from running out.",
    destination: { kind: "system", tab: "logistics" },
    defaultOn: true,
    hideable: true,
    order: 2,
  },
  demand_unservable: {
    tier: "important",
    icon: RouteOff,
    faulted: false,
    label: "Demand unservable",
    conditionLine: "A shortfall no reachable supplier or local production can close.",
    destination: { kind: "system", tab: "logistics" },
    defaultOn: true,
    hideable: true,
    order: 3,
  },
  overcrowded: {
    tier: "important",
    icon: BedDouble,
    faulted: false,
    label: "Overcrowded",
    conditionLine: "Population has outgrown the housing built for it.",
    destination: { kind: "system", tab: "population" },
    defaultOn: true,
    hideable: true,
    order: 4,
  },
  no_housing_headroom: {
    tier: "important",
    icon: BedDouble,
    faulted: true,
    label: "No housing headroom",
    conditionLine: "Overcrowded, and there's no room left to build more housing.",
    destination: { kind: "system", tab: "population" },
    defaultOn: true,
    hideable: true,
    order: 5,
  },
  build_blocked: {
    tier: "important",
    icon: HardHat,
    faulted: true,
    label: "Build blocked",
    conditionLine: "The planner wanted to build production here and couldn't.",
    destination: { kind: "system", tab: "industry" },
    defaultOn: false,
    hideable: true,
    order: 6,
  },
  industry_idle: {
    tier: "important",
    icon: Factory,
    faulted: true,
    label: "Industry idle",
    conditionLine: "Built capacity that isn't running.",
    destination: { kind: "system", tab: "industry" },
    defaultOn: false,
    hideable: true,
    order: 7,
  },
  disruption: {
    tier: "important",
    icon: TriangleAlert,
    faulted: false,
    label: "Disruption",
    conditionLine: "An event that's costing a world without threatening it.",
    destination: { kind: "events" },
    defaultOn: true,
    hideable: true,
    order: 8,
  },

  // ── info — opportunities and windfalls ───────────────────────
  build_opportunity: {
    tier: "info",
    icon: HardHat,
    faulted: false,
    label: "Build opportunity",
    conditionLine: "A ranked build the planner recommends, while build automation is off.",
    destination: { kind: "system", tab: "industry" },
    defaultOn: true,
    hideable: true,
    order: 0,
  },
  colony_opportunity: {
    tier: "info",
    icon: Globe,
    faulted: false,
    label: "Colony opportunity",
    conditionLine: "A controlled system worth colonising, while colonisation automation is off.",
    destination: { kind: "system", tab: "" },
    defaultOn: true,
    hideable: true,
    order: 1,
  },
  windfall: {
    tier: "info",
    icon: Sparkles,
    faulted: false,
    label: "Windfall",
    conditionLine: "An event worth riding before it ends.",
    destination: { kind: "events" },
    defaultOn: true,
    hideable: true,
    order: 2,
  },
};

/**
 * Worst-first authored rank for Build blocked's within-category sort — lower is worse, matching
 * `EVENT_BAND.impactRank`'s convention. Lives beside the category table rather than next to
 * `BuildDropReason` because it is a presentation ordering, not an engine fact: the planner's own
 * drop reasons carry no severity of their own, and "no-capacity" (fully saturated) reading as the
 * worst case is a judgment call about what a player most needs to see first.
 */
export const BUILD_DROP_SEVERITY: Record<BuildDropReason, number> = {
  "no-capacity": 1,
  "no-input-supplier": 2,
  "no-consumer": 3,
  "no-labour": 4,
  "no-whole-level": 5,
};

