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
   *
   * Re-denominated for lane-priced routing (docs/active/gameplay/logistics-lanes.md §2): route cost used to
   * be hops × HOP_WEIGHT (1.0), typically ~2 hops at the median haul; it is now Σ per-lane fuel cost
   * × congestion, typically ~2 lanes × ~8.5 fuel/lane ≈ 17 — roughly ×8.5 the old figure. Scaling
   * the base value by the same ×8.5 keeps aggregate spend at the same small fraction of budget it
   * held before (still the "rare, deliberate" signal the docstring above promises, not an ambient
   * brake) rather than silently starving every haul under the new, larger cost.
   */
  GENERATION_PER_POP: scaleValue(5 * 8.5),
  /** A good is a surplus when stock ≥ its warehousing target × this (`classifyMarketState`), and a
   *  donor holding a DEEP reserve gives only once stock clears that give line × this
   *  (`surplusDrawable`) — both demand-denominated since the role split; no price-anchor quantity.
   *  A give line that is the restart buffer is margin-free and carries no dead-band above it, as a
   *  producer's always has. Margin > 1 leaves a deliberate residual (negative space). */
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
   *
   * Now the restart buffer for every role, not the producer's alone: a producer's own output
   * refills it, a supplier's steady deliveries refill it, and an idle world (one whose realised use
   * has fallen away) keeps it as what its own restart needs — the one thin line every role never
   * gives below. Still anchor-immune for all three: none of them is warehouse policy that should
   * move with a price-anchor event.
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
   * Cycles of its own REALISED use — what a consumer world actually removed from this good's
   * stock over the rolling window, not its full-rate demand — that an ordinary (non-exporter,
   * non-supplier) donor keeps for itself before it will give anything away, floored at
   * `EXPORT_RESERVE_COVER` cycles of full-rate use so a world that has stopped drawing never keeps
   * less than the restart buffer. What `surplusDrawable` measures the donor side against. Sibling
   * of `WAREHOUSE_COVER`: both are now denominated in realised use for the consumer role, and both
   * ride `anchorMult`, so an event that shifts a market's anchors moves the floor a donor stops at
   * coherently with the target the deficit side fills to.
   *
   * Equal to `WAREHOUSE_COVER` (and so to `TARGET_COVER`) today by choice, not by derivation — each
   * is free to move on its own. Its invariant is a range rather than a single reserve-vs-target
   * comparison: `DONOR_RESERVE_COVER ≥ WAREHOUSE_COVER × DEFICIT_FRACTION` (40 ≥ 32) must hold
   * whichever of the consumer's two give-line terms binds — realised use (`DONOR_RESERVE_COVER ×
   * realisedUse`) or the full-rate buffer (`EXPORT_RESERVE_COVER × use`) — since realised use can
   * sit anywhere from 0 up to full-rate use. Below that line a donor drawn down to its reserve
   * immediately reads as a deficit sink and is refilled — a drain/refill loop rather than a
   * dead-band.
   *
   * `EXPORT_RESERVE_COVER` is the naming and denominator precedent only. This constant knowingly
   * departs from that one's immunity to `anchor_shift`: an exporter's reserve is a warehousing rule
   * that has no business riding the price anchor, while the ordinary donor's floor is deliberately
   * tied to the same anchor movement as the deficit line it faces across the match.
   *
   * The production brake is a separate mechanism in the same unit family: `brakeKnee` runs off
   * the use figure and own-output capacity (`BRAKE_USE_COVER`/`BRAKE_RAMP`/`BRAKE_OUTPUT_COVER`).
   * Its ceiling sat at or below this reserve's donation line (`BRAKE_RAMP × BRAKE_USE_COVER` = 52
   * vs `SURPLUS_MARGIN × DONOR_RESERVE_COVER` = 56) only for a full-rate world on this deep line
   * (realised use = full-rate use); for every other role-authored give-line — the buffer, or a
   * consumer whose realised use has fallen below full rate — the pairing is retired by design (the
   * donation line is then denominated in the smaller realised-use figure and can sit below the
   * brake ceiling, which is accepted: such a world is not accumulating its own output to dump).
   * The 52 ≤ 56 pairing stays asserted in band-constants.test.ts as that narrower, full-rate
   * statement; nothing here moves it.
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
  /**
   * The share of full-rate use that production plus steady inbound must cover for a world to
   * qualify as a supplier — below 1 so a world topped up to exactly what it eats does not flicker
   * in and out of the role on ordinary rounding noise.
   */
  SUPPLIER_REPLENISHMENT: 0.9,
  /**
   * The time constant of every rolling per-market rate (realised use, steady inbound, late-inbound
   * share): each fold moves the average by `1 / RESERVE_WINDOW_CYCLES` of the gap to this cycle's
   * reading, so one ordinary refill of 8 cycles' worth of use moves the average by 0.2 of it, and a
   * world with zero draw takes `RESERVE_WINDOW_CYCLES × ln(deep cover / buffer cover)` cycles to
   * fall under the buffer (~55 at this window).
   */
  RESERVE_WINDOW_CYCLES: 40,
  /**
   * Consecutive logistics runs a supplier can sit short (below its deficit line) with nothing
   * credited before it reverts to consumer and stops giving, whatever its rolling averages still
   * say — losing the role is fast even though qualifying for it is slow. Bounded so the reversion
   * always lands above the ration knee even at the lowest stockpile-scale step:
   * `EXPORT_RESERVE_COVER × k_min − SUPPLIER_DROP_RUNS × (LOGISTICS_INTERVAL / CYCLE_LENGTH) >
   * RATION_COVER` (7.5 − 4 = 3.5 > 2).
   */
  SUPPLIER_DROP_RUNS: 4,
  /**
   * A supplier's want, in cycles of full-rate use — the line it re-orders under, anchor-immune like
   * the buffer it sits beside. Two invariants: the band invariant shared with every other role,
   * `EXPORT_RESERVE_COVER ≥ DEFICIT_FRACTION × SUPPLIER_WANT_COVER` (10 ≥ 9.6), so a supplier drawn
   * to its give line does not immediately read as short; and, since this line is anchor-immune and
   * can never be pushed under the ration knee by an event, `DEFICIT_FRACTION ×
   * SUPPLIER_WANT_COVER × k_min > RATION_COVER` (7.2 > 2) at the lowest stockpile-scale step.
   */
  SUPPLIER_WANT_COVER: 12,
  /**
   * The haul length, in cycles, the supplier buffer is sized to survive: a supplier re-orders on a
   * counted figure that includes stock still in flight, so the physical guarantee is the buffer
   * itself surviving the ration knee plus one gated haul —
   * `EXPORT_RESERVE_COVER × k_min > RATION_COVER + SUPPLIER_MAX_LATENCY_CYCLES` (7.5 > 6) at the
   * lowest stockpile-scale step. Set below claim 1's P90 sink-mean inbound latency (99-112 ticks)
   * and above its median (54-63), so the typical fed world qualifies as a supplier and the slowest
   * decile keeps the deep reserve instead.
   */
  SUPPLIER_MAX_LATENCY_CYCLES: 4,
  /**
   * The share of a market's credited inbound volume that may arrive later than
   * `SUPPLIER_MAX_LATENCY_CYCLES` before the supplier role is denied it — a tail statistic, because
   * what the buffer has to survive is the single refill haul, not the world's average latency.
   * Gates the role only where inbound is load-bearing to the replenishment test; a world qualifying
   * on its own production alone has no transit exposure to bound and is not gated.
   */
  SUPPLIER_LATE_SHARE: 0.1,
  /**
   * The stepped stockpile-scale control a faction sets on every give-line and want-line of its own
   * markets, for every role — "my worlds hold more" or "my worlds hold less". Multiplying every
   * line in a pair leaves the ratios between them, and every invariant stated above, untouched; the
   * lowest step is the binding case for the ration and physical-exposure constraints above (`k_min`
   * = the minimum of this tuple), which is why lowering it — not raising the ceiling — is what
   * those invariants must be re-checked against.
   */
  STOCKPILE_SCALE_STEPS: [0.75, 1, 1.5],
} as const;
