import type { EconomyType, RegionIdentity } from "@/lib/types/game";

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
