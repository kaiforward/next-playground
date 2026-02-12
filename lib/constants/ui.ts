import type { EconomyType, RegionIdentity } from "@/lib/types/game";
import type { EVENT_DEFINITIONS } from "./events";

/** Mapping from economy type to Badge color prop. */
export const ECONOMY_BADGE_COLOR: Record<
  EconomyType,
  "green" | "amber" | "blue" | "purple" | "slate"
> = {
  agricultural: "green",
  mining: "amber",
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
