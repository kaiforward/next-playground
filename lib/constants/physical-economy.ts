/**
 * Physical-driver economy tables — the per-good production coefficients and
 * per-capita consumption needs that anchor the capacity-driven model.
 *
 * `coeff` seeds each good's per-building output (see `OUTPUT_PER_UNIT` in
 * industry.ts); `resource` marks the tier-0 deposit a good extracts (which
 * deposit caps its extractor count and whose yield multiplier weights its
 * output). Tier-1/2 goods are labour-only (space/labour-bound, no deposit gate).
 * Consumption is civilian demand: a per-capita baseline (perCapitaNeed × population)
 * plus skilled baskets added on top for skilled work performed (see
 * SKILL1_CONSUMPTION/SKILL2_CONSUMPTION below).
 *
 * All magnitudes are first-draft and calibrated via the simulator; only their
 * relative shape matters here (higher tier → smaller coeff and smaller need).
 */
import type { ResourceType } from "@/lib/types/game";
import { scaleRecord } from "@/lib/constants/economy-scale";

export interface GoodProductionDriver {
  /** Production coefficient — seeds the per-building output for this good. */
  coeff: number;
  /** Tier-0 deposit resource this good extracts (caps extractor count, weights output). Omitted for labour-only goods. */
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
  alloys: { coeff: 2.5 },
  polymers: { coeff: 3 },
  components: { coeff: 2.5 },
  consumer_goods: { coeff: 4.5 },
  munitions: { coeff: 3.5 },
  hull_plating: { coeff: 1.2 }, // intentionally below several tier-2 coeffs: a structural good population barely consumes, so only low output keeps it off the price floor
  // Tier 2 — labour-only, smaller coeffs (military assets rarest).
  electronics: { coeff: 3 },
  machinery: { coeff: 2.5 },
  weapons: { coeff: 1.6 },
  luxuries: { coeff: 1.5 },
  weapons_systems: { coeff: 0.7 },
  targeting_arrays: { coeff: 0.9 },
  reactor_cores: { coeff: 0.7 },
  ship_frames: { coeff: 0.6 },
};

/** Per-good per-capita consumption need. consRate = need × population. Higher tier → lower need. */
export const GOOD_CONSUMPTION: Record<string, number> = scaleRecord({
  // Tier 0.
  water: 0.007,
  food: 0.006,
  ore: 0.002,
  textiles: 0.002,
  gas: 0.004,
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
});

/**
 * Per-grade civilian consumption baskets — per skilled head, ADDED on top of the
 * unskilled GOOD_CONSUMPTION baseline (never replacing it). The head counts are
 * skilled work performed (computeLabourAllocation technicians/engineers), so
 * demand concentrates at developed systems and decays with a hub's industry.
 *
 * Sizing rule (first-draft; a later joint calibration pass owns finals): skilled heads are
 * a small population share (~15% technicians / ~4% engineers at a mature hub), so
 * per-head needs are large multiples of the per-capita base — targeting total
 * hub demand ≈ 2-3× base demand on basket goods. Basket goods must be a subset
 * of base-consumed goods (see lib/constants/__tests__/physical-economy.test.ts).
 */
export const SKILL1_CONSUMPTION: Record<string, number> = scaleRecord({
  consumer_goods: 0.015,
  medicine: 0.007,
  textiles: 0.005,
  electronics: 0.003,
});

/** Engineer basket — tier-2-centric; luxuries deliberately appear ONLY here. */
export const SKILL2_CONSUMPTION: Record<string, number> = scaleRecord({
  luxuries: 0.025,
  electronics: 0.02,
  consumer_goods: 0.02,
  medicine: 0.01,
});

/** Legacy soft-saturating labour half-population. Retained for back-compat; the capacity model uses explicit labour fulfilment. First-draft; simulator-calibrated. */
export const LABOUR_HALF_POP = 500;
