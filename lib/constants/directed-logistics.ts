import { scaleValue } from "@/lib/constants/economy-scale";

/**
 * Directed-logistics tuning. First-draft, simulator-calibrated; only relative shape matters.
 * See docs/active/gameplay/economy-autonomic-agency.md.
 */
export const DIRECTED_LOGISTICS = {
  /**
   * Work-budget a system contributes per cycle = population × this. Deliberately ample: the budget
   * is a capacity ceiling the matcher accounts against, and at this value it stops essentially no
   * draw (aggregate spend sits under ~2% of it at equilibrium), so deficits persist only for
   * physical reasons — thin or unreachable stock — never for money. Pricing the budget as a real
   * economic constraint is a separate, open design question; until it is answered this stays high
   * enough that funding-bound outcomes are rare, deliberate signals rather than an ambient brake.
   */
  GENERATION_PER_POP: scaleValue(5),
  /** A good is a surplus when stock ≥ its warehousing target × this (`classifyMarketState`), and an
   *  ordinary donor gives only once stock clears donorReserve × this (`surplusDrawable`) — both
   *  demand-denominated since the role split; no price-anchor quantity. Margin > 1 leaves a
   *  deliberate residual (negative space). */
  SURPLUS_MARGIN: 1.4,
  /**
   * Cycles of its own demand a structural exporter keeps on hand before shipping the rest — a
   * warehousing rule, deliberately NOT a fraction of the pricing anchor. Denominating it against
   * `TARGET_COVER` (40 cycles, a price-curve reference) put the threshold at 30 cycles of cover, which
   * a producer built to demand + PROVISION_MARGIN can only just reach: producers pinned exactly at the
   * line and shipped only their thin margin, so goods nobody could make locally — medicine, consumer
   * goods, electronics — reached almost nobody. Stated in cycles it is also immune to `anchor_shift`
   * events, which move the price anchor and have no business moving warehouse policy.
   * Well above RATION_COVER, so exporting never rations the exporter. This is distinct from the
   * initial market seed reserve.
   */
  EXPORT_RESERVE_COVER: 10,
  /**
   * Cycles of a system's REAL demand that directed logistics tries to keep on hand — the warehousing
   * target the DEFICIT test measures against.
   *
   * Deliberately its own constant rather than `TARGET_COVER`, despite currently holding the same
   * value. `TARGET_COVER` is the price-curve reference, and its denominator (`demandRate`) is floored
   * at `MIN_DEMAND` — a divide-by-zero guard on *pricing*, per that constant's own docstring. Borrowing
   * the pricing anchor as a stock target handed every market whose real demand sits under the floor a
   * target of `TARGET_COVER × MIN_DEMAND` regardless of what anyone there actually consumes: at
   * ECONOMY_SCALE=1, a 50-population colony wanting 0.015/cycle of ship frames is floored to 0.05
   * and so asked for a 2-unit target — 133 cycles of its real supply, not 40.
   * That is a founding-era pathology, invisible at equilibrium — a colony opens holding nothing on all
   * 26 goods, so it opens as a full-anchor deficit on all 26. Measured over the first 42 cycles it took
   * 24.7% of the galaxy's delivered haul volume, and over 90% of the haul of the scarce advanced goods
   * (weapons systems, reactor cores, ship frames); by 417 cycles the cohort has grown out of the floor
   * and it reads 0.3%.
   *
   * Equal to `TARGET_COVER` so that separating the roles changes behaviour at floored markets ONLY.
   * The two are free to move apart: how much a warehouse holds is a different question from where a
   * good prices at par. Sibling of `EXPORT_RESERVE_COVER` — both are warehouse policy stated in
   * cycles of real demand, which is why neither is denominated against the price anchor.
   */
  WAREHOUSE_COVER: 40,
  /** A good is a deficit when stock < logisticsTarget × this (below its warehousing target). < 1 leaves a comfortable dead-band above it (with SURPLUS_MARGIN) — the residual / negative space. */
  DEFICIT_FRACTION: 0.8,
  /**
   * Cycles of its own REAL demand an ordinary (non-exporter) donor keeps for itself before it will
   * give anything away — what `surplusDrawable` measures the donor side against. Sibling of
   * `WAREHOUSE_COVER`: both are demand-denominated logistics policy, and both ride `anchorMult`, so
   * an event that shifts a market's anchors moves the floor a donor stops at coherently with the
   * target the deficit side fills to.
   *
   * Equal to `WAREHOUSE_COVER` (and so to `TARGET_COVER`) today by choice, not by derivation — each
   * is free to move on its own, subject to one invariant: `DONOR_RESERVE_COVER ≥ WAREHOUSE_COVER ×
   * DEFICIT_FRACTION` (40 ≥ 32). Below that line a donor drawn down to its reserve immediately reads
   * as a deficit sink and is refilled — a drain/refill loop rather than a dead-band.
   *
   * `EXPORT_RESERVE_COVER` is the naming and denominator precedent only. This constant knowingly
   * departs from that one's immunity to `anchor_shift`: an exporter's reserve is a warehousing rule
   * that has no business riding the price anchor, while the ordinary donor's floor is deliberately
   * tied to the same anchor movement as the deficit line it faces across the match.
   *
   * The production brake is a separate mechanism in the same unit family: `brakeKnee` runs off
   * the use figure and physical storage (`BRAKE_USE_COVER`/`BRAKE_RAMP`/`BRAKE_OUTPUT_COVER`),
   * and its ceiling sits at or below this reserve's donation line (`BRAKE_RAMP × BRAKE_USE_COVER`
   * = 52 vs `SURPLUS_MARGIN × DONOR_RESERVE_COVER` = 56 — the dead-band, asserted in
   * band-constants.test.ts). Nothing here moves it.
   */
  DONOR_RESERVE_COVER: 40,
  /**
   * A budget-stopped deficit is recorded as funding-bound only when the shortfall still standing
   * after every affordable donor-draw exceeds this fraction of its original shortfall. The flag is
   * a gameplay gate, not telemetry — it suppresses the build planner's capacity proposals and
   * exempts producers from idle decay — so it must keep meaning "this market's shortfall persists
   * because of money": with donors filling a deficit in turn, "the last donor attempted was
   * unaffordable" would otherwise set it on a market that was in fact almost fully served,
   * flipping both gameplay gates across a large market population at once. First-draft
   * hypothesis, validated by simulator A/B only.
   */
  FUNDING_BOUND_RESIDUAL_FRACTION: 0.1,
  /** Max hops a logistics transfer may span (beyond this, route cost is treated as unreachable). */
  MAX_HOPS: 4,
  /** Per-unit route cost = quantity × (hops × HOP_WEIGHT + totalFuelCost × FUEL_WEIGHT). */
  HOP_WEIGHT: 1.0,
  FUEL_WEIGHT: 0.1,
} as const;
