/**
 * Colonisation-cost tuning — the establish/land/saturation knobs of the pool-funded expansion model
 * (docs/planned/economy-colonisation-cost.md §1–§3). First-cut, coarse values: only the relative shape
 * matters here (home-first while there is cheap building; expansion accelerating as habitable territory
 * fills). Magnitudes are calibrated against the simulator. Each is a tunable *input* with a clear
 * meaning — a per-doctrine lookup feeds them later; the valuation formula never changes.
 */
export const COLONISATION = {
  /**
   * Base settle work for a colony-establish project, BEFORE the bundled seed-housing's build cost is
   * added on top (establishWork = COLONY_ESTABLISH_WORK + housingLevels × housing level-work). The
   * establish cost is paid in the currency of forgone building and spreads over cycles — that spread
   * IS the establish time. A temporary construction stand-in until a treasury prices expansion.
   */
  COLONY_ESTABLISH_WORK: 60,
  /** Value of one unit of habitable land — new habitable land → future pop → future economy. */
  LAND_PREMIUM: 3.0,
  /** Small secondary weight on fungible general space (factories, not pop). */
  LAND_GENERAL_WEIGHT: 0.5,
  /** Small secondary weight on deposit richness (Σ deposit slots). */
  LAND_DEPOSIT_WEIGHT: 4.0,
  /**
   * Share of the land value that stays live BEFORE saturation — the land-grab instinct. 0 = expand only
   * when saturated (tall/builder); →1 = grab land regardless of home state (expansionist). The primary
   * "expansionist vs not" dial (doctrine feeds it later).
   */
  SIGMA_FLOOR: 0.25,
  /**
   * Weight on the seed-population opportunity cost netted off a colony's value (§7.3). The cost is the
   * source's forgone output for the part of the seed that must come from staffed (not idle) workers,
   * so founding naturally prefers a job-short source; this dial bridges that lost-production figure into
   * the value scalar. Coarse first-cut (per-doctrine later), calibrated against LAND_PREMIUM/σ.
   */
  SEED_POP_COST_WEIGHT: 1.0,
  /**
   * Anti-sprawl founding gate: the drawable settler supply (idle spare labour + the employed leak,
   * summed over a faction's developed systems) required PER hungry colony before the faction may open
   * another. `budget = floor(releasable / MIN_SETTLER_SUPPLY) − hungryColonies` bounds new establishes
   * per cycle, so a faction fills the colonies it has before founding more it can't populate. Coarse
   * first-cut — tuned against the simulator (colonies should populate broadly without dying empty).
   */
  MIN_SETTLER_SUPPLY: 5,
  /**
   * Cycles of the seed population's RAW consumption that a landed colony's founding endowment aims
   * at, per good the seed actually consumes. A colony used to open holding nothing, at satisfaction
   * 0 on every good, and began climbing out of a shortage it need never have been in — so it read as
   * deprived from its first cycle. The endowment is DRAWN from the founding system's own warehouses
   * and conserved: what the colony gains, the founder loses, capped so provisioning a colony can
   * never ration its founder.
   *
   * Sized on the raw rate so every good opens at the same cover of what that population genuinely
   * uses — a manifest shaped like the colony's own basket. It is deliberately NOT world-gen parity:
   * a generated market is sized off the `MIN_DEMAND`-floored rate, and at a 2-pop seed almost every
   * good sits under that floor, so parity would ship the same bundle of ship frames as of water —
   * centuries of supply of what nobody there uses.
   *
   * Denominated in cycles of demand, the warehouse-policy shape (`EXPORT_RESERVE_COVER`,
   * `WAREHOUSE_COVER`, `DONOR_RESERVE_COVER`), deliberately not against the price anchor. 30 is the
   * same 0.75 share of a full 40-cycle cover it was authored at (world-gen's
   * `INITIAL_RESERVE_ANCHOR_FRAC` keeps that share of the anchor for the seed question), held as its
   * own constant so calibration can move the two apart: a founder's willingness to part with stock
   * is a different question from how full a world-gen market starts.
   */
  FOUNDING_STOCK_COVER: 30,
} as const;
