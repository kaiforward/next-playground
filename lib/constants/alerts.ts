// Alert bar category registry — the spec's authored tier list in one place, so tier, destination
// and order cannot drift apart across the surfaces that read them.
//
// A category's authored DEFAULT is the one thing not here: it lives in
// `lib/constants/attention.ts`, which is icon-free. That record is seeded onto `WorldPlayer` at
// world-gen, and this module's lucide import cannot follow it there (`lib/world/gen.ts` runs in the
// node tick harness). One authority either way — nothing in this file states a default.

import {
  TrendingDown,
  Megaphone,
  BanknoteX,
  BatteryLow,
  TrendingUp,
  Hourglass,
  RouteOff,
  BedDouble,
  HardHat,
  Factory,
  Globe,
} from "lucide-react";
import type { AlertCategoryId, AlertCategoryDef } from "@/lib/types/alerts";
import type { BuildDropReason } from "@/lib/engine/directed-build";

/**
 * Tier, icon and destination per alert category — the authored table from the alert bar spec's tier
 * list, keyed so the compiler requires all thirteen. `order` is unique within a tier: the authored
 * order is total, so a chip cannot move once ranking runs. Each category's default on/off state is
 * `DEFAULT_ALERT_CATEGORIES` (`lib/constants/attention.ts`) — see this file's header.
 */
export const ALERT_CATEGORIES: Record<AlertCategoryId, AlertCategoryDef> = {
  // ── critical — cannot be turned off ──────────────────────────
  population_collapse: {
    tier: "critical",
    icon: TrendingDown,
    faulted: false,
    label: "Dying worlds",
    conditionLine: "A world is losing population fast enough to end it, famine or not.",
    destination: { kind: "system", tab: "population" },
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
    hideable: false,
    order: 2,
  },
  // ── important — three default off ────────────────────────────
  deprived_worlds: {
    tier: "important",
    icon: BatteryLow,
    faulted: false,
    label: "Deprived worlds",
    conditionLine: "Provision has fallen into the Deprived band.",
    destination: { kind: "system", tab: "population" },
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
    hideable: true,
    order: 7,
  },

  // ── info — opportunities ──────────────────────────────────────
  build_opportunity: {
    tier: "info",
    icon: HardHat,
    faulted: false,
    label: "Build opportunity",
    conditionLine: "A ranked build the planner recommends, while build automation is off.",
    destination: { kind: "system", tab: "industry" },
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
    hideable: true,
    order: 1,
  },
};

/**
 * Worst-first authored rank for Build blocked's within-category sort — lower is worse. Lives beside
 * the category table rather than next to `BuildDropReason` because it is a presentation ordering,
 * not an engine fact: the planner's own drop reasons carry no severity of their own, and
 * "no-capacity" (fully saturated) reading as the worst case is a judgment call about what a player
 * most needs to see first.
 */
export const BUILD_DROP_SEVERITY: Record<BuildDropReason, number> = {
  "no-capacity": 1,
  "no-input-supplier": 2,
  "no-consumer": 3,
  "no-labour": 4,
  "no-whole-level": 5,
};

