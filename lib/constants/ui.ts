import type { EconomyType } from "@/lib/types/game";

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
