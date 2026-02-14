import type { GoodTier, Hazard } from "@/lib/types/game";

export interface GoodEquilibrium {
  produces: { supply: number; demand: number };
  consumes: { supply: number; demand: number };
}

export interface GoodDefinition {
  name: string;
  description: string;
  basePrice: number;
  tier: GoodTier;
  volume: number;
  mass: number;
  volatility: number;
  hazard: Hazard;
  /** Min price multiplier on basePrice. Default 0.2 for backward compat. */
  priceFloor: number;
  /** Max price multiplier on basePrice. Default 5.0 for backward compat. */
  priceCeiling: number;
  /** Per-good equilibrium targets for producing and consuming systems. */
  equilibrium: GoodEquilibrium;
}

export const GOODS: Record<string, GoodDefinition> = {
  // ── Tier 0 — Raw ──────────────────────────────────────────────
  water: {
    name: "Water",
    description: "The most basic resource. Every settlement needs water.",
    basePrice: 25,
    tier: 0,
    volume: 2,
    mass: 2.0,
    volatility: 0.5,
    hazard: "none",
    priceFloor: 0.1,
    priceCeiling: 8.0,
    equilibrium: {
      produces: { supply: 150, demand: 25 },
      consumes: { supply: 25, demand: 140 },
    },
  },
  food: {
    name: "Food",
    description: "Agricultural produce, livestock, and organics.",
    basePrice: 30,
    tier: 0,
    volume: 1,
    mass: 1.0,
    volatility: 0.7,
    hazard: "none",
    priceFloor: 0.1,
    priceCeiling: 8.0,
    equilibrium: {
      produces: { supply: 145, demand: 30 },
      consumes: { supply: 30, demand: 140 },
    },
  },
  ore: {
    name: "Ore",
    description: "Raw minerals and unrefined metals from asteroids and planetary mines.",
    basePrice: 35,
    tier: 0,
    volume: 2,
    mass: 2.5,
    volatility: 0.6,
    hazard: "none",
    priceFloor: 0.1,
    priceCeiling: 8.0,
    equilibrium: {
      produces: { supply: 140, demand: 30 },
      consumes: { supply: 30, demand: 135 },
    },
  },
  textiles: {
    name: "Textiles",
    description: "Fibers, fabrics, and synthetic materials.",
    basePrice: 35,
    tier: 0,
    volume: 1,
    mass: 0.5,
    volatility: 0.8,
    hazard: "none",
    priceFloor: 0.1,
    priceCeiling: 8.0,
    equilibrium: {
      produces: { supply: 135, demand: 35 },
      consumes: { supply: 35, demand: 130 },
    },
  },

  // ── Tier 1 — Processed ────────────────────────────────────────
  fuel: {
    name: "Fuel",
    description: "Refined hydrogen, fusion cells, and propellant.",
    basePrice: 35,
    tier: 1,
    volume: 1,
    mass: 1.5,
    volatility: 1.0,
    hazard: "low",
    priceFloor: 0.15,
    priceCeiling: 6.0,
    equilibrium: {
      produces: { supply: 125, demand: 40 },
      consumes: { supply: 40, demand: 125 },
    },
  },
  metals: {
    name: "Metals",
    description: "Refined alloys and composite materials used in construction and manufacturing.",
    basePrice: 45,
    tier: 1,
    volume: 1,
    mass: 2.0,
    volatility: 0.8,
    hazard: "none",
    priceFloor: 0.15,
    priceCeiling: 6.0,
    equilibrium: {
      produces: { supply: 120, demand: 40 },
      consumes: { supply: 40, demand: 120 },
    },
  },
  chemicals: {
    name: "Chemicals",
    description: "Industrial compounds, reagents, solvents, and polymers.",
    basePrice: 55,
    tier: 1,
    volume: 1,
    mass: 1.0,
    volatility: 1.2,
    hazard: "low",
    priceFloor: 0.15,
    priceCeiling: 6.0,
    equilibrium: {
      produces: { supply: 115, demand: 45 },
      consumes: { supply: 45, demand: 115 },
    },
  },
  medicine: {
    name: "Medicine",
    description: "Pharmaceuticals, medical equipment, and biotech supplies.",
    basePrice: 65,
    tier: 1,
    volume: 1,
    mass: 0.5,
    volatility: 1.5,
    hazard: "none",
    priceFloor: 0.15,
    priceCeiling: 6.0,
    equilibrium: {
      produces: { supply: 110, demand: 50 },
      consumes: { supply: 50, demand: 110 },
    },
  },

  // ── Tier 2 — Advanced ─────────────────────────────────────────
  electronics: {
    name: "Electronics",
    description: "Components, processors, computing hardware, and sensor arrays.",
    basePrice: 80,
    tier: 2,
    volume: 1,
    mass: 0.5,
    volatility: 1.0,
    hazard: "none",
    priceFloor: 0.2,
    priceCeiling: 4.0,
    equilibrium: {
      produces: { supply: 105, demand: 55 },
      consumes: { supply: 55, demand: 105 },
    },
  },
  machinery: {
    name: "Machinery",
    description: "Industrial equipment, construction systems, mining rigs, and harvesters.",
    basePrice: 100,
    tier: 2,
    volume: 2,
    mass: 2.5,
    volatility: 0.8,
    hazard: "none",
    priceFloor: 0.2,
    priceCeiling: 4.0,
    equilibrium: {
      produces: { supply: 100, demand: 55 },
      consumes: { supply: 55, demand: 100 },
    },
  },
  weapons: {
    name: "Weapons",
    description: "Arms, ordnance, defensive systems, and military hardware.",
    basePrice: 120,
    tier: 2,
    volume: 1,
    mass: 1.5,
    volatility: 2.0,
    hazard: "high",
    priceFloor: 0.2,
    priceCeiling: 4.0,
    equilibrium: {
      produces: { supply: 95, demand: 60 },
      consumes: { supply: 60, demand: 95 },
    },
  },
  luxuries: {
    name: "Luxuries",
    description: "Art, rare materials, exotic goods, and prestige items.",
    basePrice: 150,
    tier: 2,
    volume: 1,
    mass: 0.5,
    volatility: 1.8,
    hazard: "none",
    priceFloor: 0.15,
    priceCeiling: 4.5,
    equilibrium: {
      produces: { supply: 100, demand: 50 },
      consumes: { supply: 45, demand: 120 },
    },
  },
} as const;

export const GOOD_NAMES = Object.keys(GOODS);
