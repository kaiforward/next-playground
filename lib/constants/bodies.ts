import type {
  BodyArchetypeId, ResourceType, ResourceVector, RichnessModifierId, SunClass,
} from "@/lib/types/game";
import { makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";

export { RESOURCE_TYPES };

// ── Body archetypes ───────────────────────────────────────────────
// resourceBase magnitudes are RELATIVE weights (0–3), scaled to real
// magnitudes via variance × size × richness.

export interface BodyArchetype {
  id: BodyArchetypeId;
  name: string;
  habitable: boolean;
  resourceBase: ResourceVector;
  /** Relative population-capacity weight (band: High 12 / Med 7 / Low 3 / VeryLow 1). */
  popCapWeight: number;
  /** Body-type danger contribution — summed into each system's body danger baseline. */
  dangerBaseline: number;
}

export const BODY_ARCHETYPES: Record<BodyArchetypeId, BodyArchetype> = {
  garden_world: {
    id: "garden_world", name: "Garden World", habitable: true,
    resourceBase: makeResourceVector({ minerals: 1, ore: 1, biomass: 2, arable: 3, water: 2 }),
    popCapWeight: 12, dangerBaseline: 0,
  },
  ocean_world: {
    id: "ocean_world", name: "Ocean World", habitable: true,
    resourceBase: makeResourceVector({ biomass: 2, arable: 1, water: 3 }),
    popCapWeight: 12, dangerBaseline: 0,
  },
  jungle_world: {
    id: "jungle_world", name: "Jungle World", habitable: true,
    resourceBase: makeResourceVector({ ore: 1, biomass: 3, arable: 2, water: 2 }),
    popCapWeight: 7, dangerBaseline: 0,
  },
  arid_world: {
    id: "arid_world", name: "Arid World", habitable: true,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, arable: 1, radioactive: 1 }),
    popCapWeight: 3, dangerBaseline: 0,
  },
  volcanic_world: {
    id: "volcanic_world", name: "Volcanic World", habitable: false,
    resourceBase: makeResourceVector({ gas: 1, minerals: 2, ore: 3, radioactive: 2 }),
    popCapWeight: 1, dangerBaseline: 0.05,
  },
  frozen_world: {
    id: "frozen_world", name: "Frozen World", habitable: false,
    resourceBase: makeResourceVector({ gas: 1, ore: 1, water: 3 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
  barren_rock: {
    id: "barren_rock", name: "Barren Rock", habitable: false,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, radioactive: 1 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
  gas_giant: {
    id: "gas_giant", name: "Gas Giant", habitable: false,
    resourceBase: makeResourceVector({ gas: 3, water: 1 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
  asteroid_belt: {
    id: "asteroid_belt", name: "Asteroid Belt", habitable: false,
    resourceBase: makeResourceVector({ minerals: 3, ore: 3, radioactive: 1 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
};

// ── Sun classes ───────────────────────────────────────────────────
// weight = selection weight; archetypeWeights absent/0 = suppressed.

export interface SunClassDef {
  id: SunClass;
  name: string;
  weight: number;
  bodyCount: { min: number; max: number };
  archetypeWeights: Partial<Record<BodyArchetypeId, number>>;
}

export const SUN_CLASSES: Record<SunClass, SunClassDef> = {
  yellow: {
    id: "yellow", name: "Yellow (Sol-like)", weight: 45, bodyCount: { min: 2, max: 5 },
    archetypeWeights: {
      garden_world: 6, ocean_world: 4, jungle_world: 4, arid_world: 2,
      volcanic_world: 1, frozen_world: 1, barren_rock: 1, gas_giant: 1, asteroid_belt: 1,
    },
  },
  blue_white: {
    id: "blue_white", name: "Blue–white (hot)", weight: 13, bodyCount: { min: 1, max: 4 },
    archetypeWeights: {
      volcanic_world: 4, barren_rock: 3, asteroid_belt: 3, arid_world: 1, gas_giant: 1,
    },
  },
  orange_dwarf: {
    id: "orange_dwarf", name: "Orange dwarf (cool)", weight: 30, bodyCount: { min: 2, max: 4 },
    archetypeWeights: {
      garden_world: 2, ocean_world: 4, jungle_world: 2, arid_world: 2,
      frozen_world: 3, barren_rock: 1, gas_giant: 2, asteroid_belt: 1,
    },
  },
  red_dwarf: {
    id: "red_dwarf", name: "Red dwarf (cold)", weight: 12, bodyCount: { min: 1, max: 3 },
    archetypeWeights: {
      arid_world: 1, frozen_world: 3, barren_rock: 3, gas_giant: 3, asteroid_belt: 3,
    },
  },
};

// ── Richness modifiers ────────────────────────────────────────────
// Rare multipliers on a single resource of an eligible body (e.g. heavy_metals →
// ore ×1.6). multiplier and rarity are hand-tuned starting values.

export interface RichnessModifier {
  id: RichnessModifierId;
  name: string;
  resource: ResourceType;
  multiplier: number;
  /** Relative roll weight when richness is rolled onto an eligible body. */
  rarity: number;
  description: string;
}

export const RICHNESS_MODIFIERS: Record<RichnessModifierId, RichnessModifier> = {
  hydrocarbon_deposits: { id: "hydrocarbon_deposits", name: "Hydrocarbon Deposits", resource: "gas", multiplier: 1.5, rarity: 1, description: "Seas of liquid hydrocarbons — a rich gas/chemical feedstock." },
  fertile_soil: { id: "fertile_soil", name: "Fertile Lowlands", resource: "arable", multiplier: 1.5, rarity: 1, description: "Exceptionally fertile soil over wide lowlands." },
  coral_reefs: { id: "coral_reefs", name: "Coral Archipelago", resource: "biomass", multiplier: 1.4, rarity: 1, description: "Vast shallow-sea ecosystems teeming with marine biomass." },
  tectonic_concentration: { id: "tectonic_concentration", name: "Tectonic Forge", resource: "ore", multiplier: 1.5, rarity: 1, description: "Geological pressure concentrates ore near the surface." },
  mineral_moons: { id: "mineral_moons", name: "Mineral-Rich Moons", resource: "minerals", multiplier: 1.4, rarity: 1, description: "Satellite bodies with solid mineral deposits." },
  ice_rings: { id: "ice_rings", name: "Ring System", resource: "water", multiplier: 1.4, rarity: 1, description: "Dense bands of ice yield abundant water." },
  rare_earth: { id: "rare_earth", name: "Rare Earth Deposits", resource: "minerals", multiplier: 1.5, rarity: 1, description: "Concentrations of rare-earth elements." },
  heavy_metals: { id: "heavy_metals", name: "Heavy Metal Veins", resource: "ore", multiplier: 1.6, rarity: 1, description: "Rich veins of titanium, tungsten, and uranium." },
  organic_compounds: { id: "organic_compounds", name: "Organic Compounds", resource: "biomass", multiplier: 1.4, rarity: 1, description: "Pre-biotic chemistry and complex organic deposits." },
  helium3: { id: "helium3", name: "Helium-3 Reserves", resource: "gas", multiplier: 1.6, rarity: 1, description: "Strategically valuable fusion-fuel gas reserves." },
  radioactive_lode: { id: "radioactive_lode", name: "Radioactive Deposits", resource: "radioactive", multiplier: 1.6, rarity: 1, description: "Fissile-material reserves — high value, hazardous." },
  superdense: { id: "superdense", name: "Superdense Core", resource: "ore", multiplier: 1.6, rarity: 1, description: "An ultra-dense core yields extreme ore concentrations." },
  glacial_aquifer: { id: "glacial_aquifer", name: "Glacial Aquifer", resource: "water", multiplier: 1.6, rarity: 1, description: "Immense underground frozen-water reserves." },
};
