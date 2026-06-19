/**
 * Physical-driver economy tables — production and consumption derive from a
 * system's substrate (resource aggregate + population), not an economy-type
 * rate table.
 *
 * Production rate per good:
 *   coeff × labourFactor(population) × (resource ? aggregate[resource] : 1)
 * Tier-0 goods are resource-driven (scale with a deposit magnitude); tier-1/2
 * goods are labour-only (space/labour-bound, no deposit gate). Consumption is
 * universal and population-scaled: perCapitaNeed × population.
 *
 * All magnitudes are first-draft and calibrated via the simulator; only their
 * relative shape matters here (higher tier → smaller coeff and smaller need).
 */
import type { ResourceType } from "@/lib/types/game";

export interface GoodProductionDriver {
  /** Production coefficient — multiplied by labour (and the resource magnitude when resource-driven). */
  coeff: number;
  /** Tier-0 resource whose aggregate magnitude gates production. Omitted for labour-only goods. */
  resource?: ResourceType;
}

/** Per-good production drivers. Arable splits across food + textiles via differing coeffs. */
export const GOOD_PRODUCTION: Record<string, GoodProductionDriver> = {
  // Tier 0 — resource-driven (scale with deposit magnitude AND labour).
  water: { coeff: 1.5, resource: "water" },
  food: { coeff: 1.5, resource: "arable" },
  ore: { coeff: 1.2, resource: "ore" },
  textiles: { coeff: 0.6, resource: "arable" },
  gas: { coeff: 1.2, resource: "gas" },
  minerals: { coeff: 1.0, resource: "minerals" },
  biomass: { coeff: 1.2, resource: "biomass" },
  radioactives: { coeff: 0.8, resource: "radioactive" },
  // Tier 1 — labour-only.
  fuel: { coeff: 5 },
  metals: { coeff: 5 },
  chemicals: { coeff: 4 },
  medicine: { coeff: 3.5 },
  alloys: { coeff: 4 },
  polymers: { coeff: 4.5 },
  components: { coeff: 4 },
  consumer_goods: { coeff: 4.5 },
  munitions: { coeff: 3.5 },
  hull_plating: { coeff: 3.5 },
  // Tier 2 — labour-only, smaller coeffs (luxuries rarest).
  electronics: { coeff: 3 },
  machinery: { coeff: 2.5 },
  weapons: { coeff: 2 },
  luxuries: { coeff: 1.5 },
  weapons_systems: { coeff: 1.5 },
  targeting_arrays: { coeff: 2 },
  reactor_cores: { coeff: 1.5 },
  ship_frames: { coeff: 1.2 },
};

/** Per-good per-capita consumption need. consRate = need × population. Higher tier → lower need. */
export const GOOD_CONSUMPTION: Record<string, number> = {
  // Tier 0.
  water: 0.004,
  food: 0.004,
  ore: 0.002,
  textiles: 0.002,
  gas: 0.003,
  minerals: 0.002,
  biomass: 0.002,
  radioactives: 0.0008,
  // Tier 1.
  fuel: 0.0015,
  metals: 0.0015,
  chemicals: 0.0015,
  medicine: 0.001,
  alloys: 0.001,
  polymers: 0.0012,
  components: 0.001,
  consumer_goods: 0.0015,
  munitions: 0.0005,
  hull_plating: 0.0005,
  // Tier 2.
  electronics: 0.001,
  machinery: 0.0008,
  weapons: 0.0005,
  luxuries: 0.0005,
  weapons_systems: 0.0003,
  targeting_arrays: 0.0004,
  reactor_cores: 0.0003,
  ship_frames: 0.0003,
};

/** Population at which labourFactor reaches 0.5 (soft-saturating curve). First-draft; simulator-calibrated. */
export const LABOUR_HALF_POP = 500;
