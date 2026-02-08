import type { GoodCategory } from "@/lib/types/game";

export interface GoodDefinition {
  name: string;
  basePrice: number;
  category: GoodCategory;
}

export const GOODS: Record<string, GoodDefinition> = {
  food: { name: "Food", basePrice: 20, category: "consumable" },
  ore: { name: "Ore", basePrice: 30, category: "raw" },
  fuel: { name: "Fuel", basePrice: 40, category: "raw" },
  electronics: { name: "Electronics", basePrice: 80, category: "manufactured" },
  ship_parts: { name: "Ship Parts", basePrice: 100, category: "manufactured" },
  luxuries: { name: "Luxuries", basePrice: 150, category: "luxury" },
} as const;

export const GOOD_NAMES = Object.keys(GOODS);
