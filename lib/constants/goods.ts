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
}

export const GOODS: Record<string, GoodDefinition> = {
  // ── Tier 0 — Raw ──────────────────────────────────────────────
  water: {
    name: "Water",
    description: "The most basic resource. Every settlement needs water.",
    basePrice: 10,
    tier: 0,
    volume: 2,
    mass: 2.0,
    volatility: 0.5,
    hazard: "none",
  },
  food: {
    name: "Food",
    description: "Agricultural produce, livestock, and organics.",
    basePrice: 15,
    tier: 0,
    volume: 1,
    mass: 1.0,
    volatility: 0.7,
    hazard: "none",
  },
  ore: {
    name: "Ore",
    description: "Raw minerals and unrefined metals from asteroids and planetary mines.",
    basePrice: 20,
    tier: 0,
    volume: 2,
    mass: 2.5,
    volatility: 0.6,
    hazard: "none",
  },
  textiles: {
    name: "Textiles",
    description: "Fibers, fabrics, and synthetic materials.",
    basePrice: 25,
    tier: 0,
    volume: 1,
    mass: 0.5,
    volatility: 0.8,
    hazard: "none",
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
  },
} as const;

export const GOOD_NAMES = Object.keys(GOODS);
