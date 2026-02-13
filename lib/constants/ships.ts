export interface ShipTypeDefinition {
  id: ShipTypeId;
  name: string;
  description: string;
  fuel: number;
  cargo: number;
  /** Price in credits. 0 = starter only, not purchasable. */
  price: number;
}

export type ShipTypeId = "shuttle" | "freighter";

export const SHIP_TYPES: Record<ShipTypeId, ShipTypeDefinition> = {
  shuttle: {
    id: "shuttle",
    name: "Shuttle",
    description: "A nimble starter craft with balanced fuel and cargo capacity.",
    fuel: 100,
    cargo: 50,
    price: 0,
  },
  freighter: {
    id: "freighter",
    name: "Freighter",
    description: "A heavy hauler with expanded cargo bays at the cost of a smaller fuel tank.",
    fuel: 80,
    cargo: 120,
    price: 5000,
  },
};

/** Ship types available for purchase at shipyards. */
export const PURCHASABLE_SHIP_TYPES: ShipTypeDefinition[] = Object.values(
  SHIP_TYPES,
).filter((t) => t.price > 0);
