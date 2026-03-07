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
  /** Min price multiplier on basePrice. */
  priceFloor: number;
  /** Max price multiplier on basePrice. */
  priceCeiling: number;
  /** Per-good equilibrium targets for producing and consuming systems. */
  equilibrium: GoodEquilibrium;
}

export const GOODS: Record<string, GoodDefinition> = {
  // ── Tier 0 — Raw ──────────────────────────────────────────────
  // High volume (150-160 supply), widest ratio spread (~20%).
  // Cheap per unit, always available, bread-and-butter early game income.
  // A shuttle pilot with 500cr fills cargo with these.
  water: {
    name: "Water",
    description: "The most basic resource. Every settlement needs water.",
    basePrice: 25,
    tier: 0,
    volume: 2,
    mass: 2.0,
    volatility: 0.5,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
    equilibrium: {
      // buy ~21.3, sell ~26.4, margin ~5.1/unit
      produces: { supply: 160, demand: 136 },
      consumes: { supply: 110, demand: 116 },
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
    priceFloor: 0.5,
    priceCeiling: 2.0,
    equilibrium: {
      // buy ~26.1, sell ~31.1, margin ~5.0/unit
      produces: { supply: 155, demand: 135 },
      consumes: { supply: 110, demand: 114 },
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
    priceFloor: 0.5,
    priceCeiling: 2.0,
    equilibrium: {
      // buy ~30.0, sell ~36.2, margin ~6.2/unit
      produces: { supply: 155, demand: 133 },
      consumes: { supply: 115, demand: 119 },
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
    priceFloor: 0.5,
    priceCeiling: 2.0,
    equilibrium: {
      // buy ~30.1, sell ~35.9, margin ~5.8/unit
      produces: { supply: 150, demand: 129 },
      consumes: { supply: 110, demand: 113 },
    },
  },

  // ── Tier 1 — Processed ────────────────────────────────────────
  // Medium volume (78-90 supply), moderate ratio spread (~17-20%).
  // Better per-unit margin but needs more capital to trade.
  // Mid-game income — becomes viable once you have a few thousand credits.
  fuel: {
    name: "Fuel",
    description: "Refined hydrogen, fusion cells, and propellant.",
    basePrice: 35,
    tier: 1,
    volume: 1,
    mass: 1.5,
    volatility: 1.0,
    hazard: "low",
    priceFloor: 0.5,
    priceCeiling: 2.5,
    equilibrium: {
      // buy ~29.2, sell ~37.3, margin ~8.2/unit
      produces: { supply: 90, demand: 75 },
      consumes: { supply: 60, demand: 64 },
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
    priceFloor: 0.5,
    priceCeiling: 2.5,
    equilibrium: {
      // buy ~38.1, sell ~47.3, margin ~9.2/unit
      produces: { supply: 85, demand: 72 },
      consumes: { supply: 58, demand: 61 },
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
    priceFloor: 0.5,
    priceCeiling: 2.5,
    equilibrium: {
      // buy ~47.4, sell ~56.9, margin ~9.5/unit
      produces: { supply: 80, demand: 69 },
      consumes: { supply: 56, demand: 58 },
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
    priceFloor: 0.5,
    priceCeiling: 2.5,
    equilibrium: {
      // buy ~56.7, sell ~67.4, margin ~10.7/unit
      produces: { supply: 78, demand: 68 },
      consumes: { supply: 55, demand: 57 },
    },
  },

  // ── Tier 2 — Advanced ─────────────────────────────────────────
  // Scarce (38-45 supply), tightest ratio spread (~12-17%).
  // Highest absolute margin per unit but can't fill cargo from one system.
  // Late-game income — needs big capital AND multi-system routes.
  electronics: {
    name: "Electronics",
    description: "Components, processors, computing hardware, and sensor arrays.",
    basePrice: 80,
    tier: 2,
    volume: 1,
    mass: 0.5,
    volatility: 1.0,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 3.0,
    equilibrium: {
      // buy ~69.3, sell ~82.9, margin ~13.6/unit
      produces: { supply: 45, demand: 39 },
      consumes: { supply: 28, demand: 29 },
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
    priceFloor: 0.5,
    priceCeiling: 3.0,
    equilibrium: {
      // buy ~88.1, sell ~103.7, margin ~15.6/unit
      produces: { supply: 42, demand: 37 },
      consumes: { supply: 27, demand: 28 },
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
    priceFloor: 0.5,
    priceCeiling: 3.0,
    equilibrium: {
      // buy ~108.0, sell ~124.8, margin ~16.8/unit
      produces: { supply: 40, demand: 36 },
      consumes: { supply: 25, demand: 26 },
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
    priceFloor: 0.5,
    priceCeiling: 3.0,
    equilibrium: {
      // buy ~138.2, sell ~156.3, margin ~18.1/unit
      produces: { supply: 38, demand: 35 },
      consumes: { supply: 24, demand: 25 },
    },
  },
} as const;

export const GOOD_NAMES = Object.keys(GOODS);

/** Reverse lookup: Good.name -> GOODS key (e.g. "Food" -> "food"). */
export const GOOD_NAME_TO_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(GOODS).map(([key, def]) => [def.name, key]),
);

/** Good tier indexed by GOODS key (e.g. "food" -> 0). */
export const GOOD_TIER_BY_KEY: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(GOODS).map(([key, def]) => [key, def.tier]),
);
