import type { EconomyType } from "@/lib/types/game";

// Production/consumption rules per economy type
export const ECONOMY_PRODUCTION: Record<EconomyType, string[]> = {
  agricultural: ["food"],
  mining: ["ore"],
  industrial: ["fuel", "ship_parts"],
  tech: ["electronics"],
  core: ["luxuries"],
};

export const ECONOMY_CONSUMPTION: Record<EconomyType, string[]> = {
  agricultural: ["electronics"],
  mining: ["food"],
  industrial: ["ore"],
  tech: ["ore", "ship_parts"],
  core: ["food", "ore", "fuel", "electronics", "ship_parts"],
};
