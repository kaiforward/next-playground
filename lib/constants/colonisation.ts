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
   * IS the establish time. Deliberately generic: this work bills through the construction band like
   * any other build, and the colony-specific money is the charter fee and the staged materials below.
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
  /**
   * Multiplier on the faction's last-settlement MAINTENANCE bill that sets the colony charter fee:
   * `charter = max(CHARTER_FEE_MIN, CHARTER_FEE_SPEND_MULT × lastSettlement.maintenanceBill)`.
   *
   * Maintenance, not the total bill, because maintenance is a standing-stock proxy for how much
   * faction there is to administer and does not move with the faction's own founding activity. The
   * construction bill is ~78% of the founding-era total and is largely the founding burst itself, so
   * a total-bill charter would self-reinforce during the burst and collapse at equilibrium — the
   * opposite of a knob that stays independent of the thing it prices.
   *
   * Coarse first-cut: the founding-era per-cycle maintenance bill is ≈91.6 per faction, and the
   * measured bite point is one cycle of per-faction total spend (≈598), so 6.5 × 91.6 ≈ 595. This is
   * by design the DOMINANT monetary cost of a colony — roughly 3–5× the material bill — and the knob
   * to move first if founding needs slowing.
   */
  CHARTER_FEE_SPEND_MULT: 6.5,
  /**
   * A real `max()` floor under the charter fee, not a null-fallback: it binds at any horizon for any
   * faction whose maintenance bill has collapsed, and it also covers the (nearly dead) pre-settlement
   * case — the first settlement lands at t=24 and the first founding at t=432. Sized at about the
   * scale of the material bill itself, so the cheapest possible colony still costs roughly what its
   * goods cost.
   */
  CHARTER_FEE_MIN: 100,
  /**
   * Multiplier on a candidate's PROJECTED material bill in the affordability gate: a colony is
   * proposed (or a player order accepted) only while the faction's working balance covers
   * `charter + FOUNDING_GATE_HEADROOM × projectedBill`. Reserves headroom for the staging draws the
   * establish will make over its life, which are paid cycle by cycle rather than up front.
   *
   * The gate is charter-dominated by design: the projected (uncapped) bill is ≈195, so 2.0 reserves
   * ≈390 against a ≈595 charter. The headroom is the secondary term.
   */
  FOUNDING_GATE_HEADROOM: 2.0,
  /**
   * Consecutive cycles staging NOTHING after which an in-flight colony writes off its remaining
   * manifest: the unstaged remainder counts as satisfied from then on, the materials ceiling stops
   * binding, and the project finishes on construction work alone and opens with whatever is already
   * in its ledger. A colony that opens poor is a legible outcome; a colony that never opens is not.
   * The counter runs only once the charter is paid, so a project that cannot afford its charter can
   * never escape into a free colony.
   *
   * ~8 is roughly half a nominal establish (68 work ÷ an absorption cap of 4 ⇒ ≥17 cycles) — long
   * enough that ordinary lumpiness in a founder's spare stock does not trip it.
   */
  FOUNDING_STALL_COMPLETE_CYCLES: 8,
} as const;
