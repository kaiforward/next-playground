import type { GoodTier, Hazard } from "@/lib/types/game";

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
}

export const GOODS: Record<string, GoodDefinition> = {
  // ── Tier 0 — Raw ──────────────────────────────────────────────
  // Deep, liquid markets, thin per-unit margin.
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
  },
  gas: {
    name: "Gas",
    description: "Hydrogen, helium-3, and atmospheric gases — raw energy feedstock.",
    basePrice: 30,
    tier: 0,
    volume: 2,
    mass: 1.0,
    volatility: 0.7,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
  minerals: {
    name: "Minerals",
    description: "Rare earths, crystalline materials, and precision-grade ores.",
    basePrice: 40,
    tier: 0,
    volume: 1,
    mass: 2.0,
    volatility: 0.8,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
  biomass: {
    name: "Biomass",
    description: "Organic compounds and biological feedstock for synthesis.",
    basePrice: 32,
    tier: 0,
    volume: 2,
    mass: 1.5,
    volatility: 0.6,
    hazard: "none",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },
  radioactives: {
    name: "Radioactives",
    description: "Fissile materials and isotopes — high value, high hazard.",
    basePrice: 50,
    tier: 0,
    volume: 1,
    mass: 2.0,
    volatility: 1.2,
    hazard: "high",
    priceFloor: 0.5,
    priceCeiling: 2.0,
  },

  // ── Tier 1 — Processed ────────────────────────────────────────
  // Medium-depth markets, moderate per-unit margin.
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
  },
  alloys: {
    name: "Alloys",
    description: "High-strength composite metals — titanium alloys, durasteel.",
    basePrice: 60, tier: 1, volume: 1, mass: 2.0,
    volatility: 0.8, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  polymers: {
    name: "Polymers",
    description: "Plastics, synthetics, and carbon fibre from petrochemicals and bioprocessing.",
    basePrice: 48, tier: 1, volume: 1, mass: 1.0,
    volatility: 0.7, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  components: {
    name: "Components",
    description: "Precision parts — circuit boards, actuators, micro-assemblies. The universal intermediate.",
    basePrice: 70, tier: 1, volume: 1, mass: 1.0,
    volatility: 0.9, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  consumer_goods: {
    name: "Consumer Goods",
    description: "Everyday manufactured products — clothing, tools, devices.",
    basePrice: 55, tier: 1, volume: 1, mass: 1.0,
    volatility: 0.6, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },
  munitions: {
    name: "Munitions",
    description: "Ammunition, explosives, and propellant charges.",
    basePrice: 75, tier: 1, volume: 1, mass: 1.5,
    volatility: 1.3, hazard: "low", priceFloor: 0.5, priceCeiling: 2.5,
  },
  hull_plating: {
    name: "Hull Plating",
    description: "Armour plates and structural panels — military-grade structural material.",
    basePrice: 70, tier: 1, volume: 2, mass: 2.5,
    volatility: 0.9, hazard: "none", priceFloor: 0.5, priceCeiling: 2.5,
  },

  // ── Tier 2 — Advanced ─────────────────────────────────────────
  // Thin, scarce markets, high per-unit price swing.
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
  },
} as const;

export const GOOD_NAMES = Object.keys(GOODS);

/** Reverse lookup: Good.name -> GOODS key (e.g. "Food" -> "food"). */
export const GOOD_NAME_TO_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(GOODS).map(([key, def]) => [def.name, key]),
);

/** Good tier indexed by GOODS key (e.g. "food" -> 0). */
export const GOOD_TIER_BY_KEY: Readonly<Record<string, GoodTier>> = (() => {
  const out: Record<string, GoodTier> = {};
  for (const [key, def] of Object.entries(GOODS)) {
    out[key] = def.tier;
  }
  return out;
})();
