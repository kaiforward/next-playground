/**
 * Supply-chain recipes: produced good -> { input good: units consumed per unit
 * output }. Tier-0 goods are resource-extracted and have NO recipe (absent
 * here). Input quantities are first-draft tuning knobs; only the input
 * *structure* (which goods feed which) is fixed.
 *
 * Nothing consumes this table yet — it is the single source of truth for the
 * production graph, validated as an acyclic DAG by recipes.test.ts so a
 * consumer can topologically order production within a system (a
 * freshly-produced input can feed its consumer the same tick).
 */
export const GOOD_RECIPES: Record<string, Record<string, number>> = {
  // ── Tier 1 ────────────────────────────────────────────────
  fuel: { gas: 1 },
  metals: { ore: 1 },
  chemicals: { gas: 0.5, minerals: 0.5 },
  medicine: { biomass: 0.5, chemicals: 0.5 },
  alloys: { metals: 0.6, minerals: 0.4 },
  polymers: { gas: 0.5, biomass: 0.5 },
  components: { minerals: 0.5, metals: 0.5 },
  consumer_goods: { textiles: 0.5, polymers: 0.5 },
  munitions: { metals: 0.5, chemicals: 0.5 },
  hull_plating: { metals: 0.5, alloys: 0.5 },
  // ── Tier 2 ────────────────────────────────────────────────
  electronics: { components: 0.6, chemicals: 0.4 },
  machinery: { metals: 0.5, components: 0.5 },
  weapons: { metals: 0.4, chemicals: 0.3, munitions: 0.3 },
  luxuries: { consumer_goods: 0.5, electronics: 0.5 },
  weapons_systems: { electronics: 0.4, munitions: 0.3, hull_plating: 0.3 },
  targeting_arrays: { electronics: 0.6, components: 0.4 },
  reactor_cores: { radioactives: 0.4, alloys: 0.3, components: 0.3 },
  ship_frames: { hull_plating: 0.4, alloys: 0.3, components: 0.3 },
};
