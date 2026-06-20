import type {
  BodyArchetypeId, ResourceVector, SunClass,
} from "@/lib/types/game";
import { makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";

export { RESOURCE_TYPES };

// ── Body archetypes ───────────────────────────────────────────────
// resourceBase is the per-resource deposit WEIGHT vector (0–3) that drives the
// surface partition into extractor slots.

export interface BodyArchetype {
  id: BodyArchetypeId;
  name: string;
  habitable: boolean;
  resourceBase: ResourceVector;
  /** Body-type danger contribution — summed into each system's body danger baseline. */
  dangerBaseline: number;
  /** Relative weight of fungible/buildable general space on this body type (higher = more land to develop). */
  generalWeight: number;
  /** Fraction of general space that is habitable (supports population centres). Range [0, 1]. */
  habitableFraction: number;
}

export const BODY_ARCHETYPES: Record<BodyArchetypeId, BodyArchetype> = {
  garden_world: {
    id: "garden_world", name: "Garden World", habitable: true,
    resourceBase: makeResourceVector({ minerals: 1, ore: 1, biomass: 2, arable: 3, water: 2 }),
    dangerBaseline: 0,
    generalWeight: 9, habitableFraction: 0.7,
  },
  ocean_world: {
    id: "ocean_world", name: "Ocean World", habitable: true,
    resourceBase: makeResourceVector({ biomass: 2, arable: 1, water: 3 }),
    dangerBaseline: 0,
    generalWeight: 6, habitableFraction: 0.45,
  },
  jungle_world: {
    id: "jungle_world", name: "Jungle World", habitable: true,
    resourceBase: makeResourceVector({ ore: 1, biomass: 3, arable: 2, water: 2 }),
    dangerBaseline: 0,
    generalWeight: 7, habitableFraction: 0.5,
  },
  arid_world: {
    id: "arid_world", name: "Arid World", habitable: true,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, arable: 1, radioactive: 1 }),
    dangerBaseline: 0,
    generalWeight: 5, habitableFraction: 0.25,
  },
  volcanic_world: {
    id: "volcanic_world", name: "Volcanic World", habitable: false,
    resourceBase: makeResourceVector({ gas: 1, minerals: 2, ore: 3, radioactive: 2 }),
    dangerBaseline: 0.05,
    generalWeight: 2, habitableFraction: 0.03,
  },
  frozen_world: {
    id: "frozen_world", name: "Frozen World", habitable: false,
    resourceBase: makeResourceVector({ gas: 1, ore: 1, water: 3 }),
    dangerBaseline: 0,
    generalWeight: 3, habitableFraction: 0.05,
  },
  barren_rock: {
    id: "barren_rock", name: "Barren Rock", habitable: false,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, radioactive: 1 }),
    dangerBaseline: 0,
    generalWeight: 3, habitableFraction: 0.05,
  },
  gas_giant: {
    id: "gas_giant", name: "Gas Giant", habitable: false,
    resourceBase: makeResourceVector({ gas: 3, water: 1 }),
    dangerBaseline: 0,
    generalWeight: 1, habitableFraction: 0.02,
  },
  asteroid_belt: {
    id: "asteroid_belt", name: "Asteroid Belt", habitable: false,
    resourceBase: makeResourceVector({ minerals: 3, ore: 3, radioactive: 1 }),
    dangerBaseline: 0,
    generalWeight: 2, habitableFraction: 0.02,
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
