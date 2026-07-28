# Economy Band Reconciliation — Build Umbrella

Transient build-plan umbrella for the band-reconciliation pass. The **functional spec** (source of
truth for every mechanic here) is `docs/planned/economy-band-reconciliation.md` — settled
2026-07-20, spec-review gate run and all 13 findings folded in (report:
`.claude/reviews/spec-economy-band-reconciliation-2026-07-20-182256.md`). This doc locks the PR
decomposition, the cross-PR interfaces, and the expected interim states. Per-PR task plans are
authored as each PR starts (PR1–PR4 are shipped to the shared branch); on final ship the
spec promotes to `docs/active/`, SPEC.md and `economy-equilibrium-rework.md` update, and every
`band-reconciliation-*.md` build file here is deleted.

## Branch strategy

Shared feature branch **`feat/band-reconciliation`** off `main`. Each PR below is its own small
branch off the shared branch, `/uber-review`'d going in (diffing against the shared branch), then
squashed/fast-forwarded into it. One final PR shared→main with a light sanity pass. `main` never
sees an interim state — the interim incoherences listed per PR are shared-branch-only.

## PR decomposition (6 PRs, in order)

### PR1 — Curve geometry, floor retirement, satisfaction as persisted flow (§1 consume/produce knees, §4)

The sim core. Consumption gains an emergency ration threshold (full delivery above
`RATION_COVER × demandRate`, initially 2 cycles; √ ramp to 0
at empty); production runs full to the anchor then ramps linearly to 0 at `HOLD_COVER × T`;
`minStock` stops clamping anywhere (stock clamps to `[0, maxStock]`; input/recipe draws and event
shocks run toward empty on the shared scarcity ramp); seeds retain a separately named
0.75 × T initial reserve. Satisfaction becomes the flow actually applied (delivered ÷ demanded), persisted per
(system, good) as `WorldMarket.satisfaction?` (missing ⇒ 1), and both secondary computation sites
re-base onto it: the pop-needs display and the planner's `supplyDissatisfaction` fed-proxy.
Harness: stock-pin metric re-bases to true floor pins (stock ≈ 0).

- **Status: shipped** to `feat/band-reconciliation` at `a0da9b5` (2026-07-21).
- Plan: `band-reconciliation-pr1-curves.md`.
- **Interim incoherence (expected, until PR2):** the decay signal still reads the old
  storage-band `outputUptake`; at the new resting point (stock just above `T`) producers read
  uptake ≈ 0.8, so producer stacks ≥ ~6 levels shed a level per buffer. Do not chase this in PR1 —
  it is the exact defect PR2 removes. Sim checks for PR1 are satisfaction/price/no-NaN only.

### PR2 — Selling/decay signal + housing vacancy + idle buffer (§1 selling bullet, §5)

The decay side of the same reconciliation. The producer decay/Glut signal becomes the **isolated
ceiling term**: the economy pulse emits `sellingFactor` per (system, good) = the §1 production-knee
throttle alone (the `productionCeiling` primitive PR1 lands, evaluated at the pulse's stock) —
never realized/suppressed/input-gated output. Decay `used = count × min(effectiveFulfilment,
sellingFactor + USED_SLACK)`; `UtilizationContext.outputUptake` becomes the selling-factor accessor
at both call sites (decay engine + `buildIndustryReadout`), the old full-band `outputUptake` and
the last `selfLimitingFactor` call sites are deleted. Funding-bound exclusion: the directed-logistics
matcher gains an observable "wanted-but-unfunded" output (today budget exhaustion is a silent
`break` at `directed-logistics.ts:139`) so a funding-limited exporter reads used, not glut. Housing
decay gains `VACANCY_SLACK` (0.10): `used = min(count, occupancy × 1.10)`. `idleBufferMonths` 6 → 12.
Invariant asserted in tests: the selling factor contains no labour/input/strike/maintenance/event
term (the purse flow-only guarantee, `treasury.ts:128-136`).

- Consumes from PR1: `productionCeiling(stock, targetStock, holdCover)`, `RATION_COVER`.
- **Status: complete** — PR #198; task-level plan: `band-reconciliation-pr2-decay.md`.
- **Interim incoherence (until PR3/PR4):** planner still capacity-blind; housing treadmill only
  half-fixed (vacancy slack lands, but growth/relief flip is PR4).

### PR3 — Build planner + logistics (§2)

Plan: `band-reconciliation-pr3-planner-logistics.md`.

Realized-aware classification: `toGoodMarketStates`' `production` figure applies the suppression
multipliers and input gates (the tick already emits `realizedProductionBySystem`; thread it — and
last-pulse persistence for off-month pulses — into the planner rows/ctx, which today get a bare
`{ tick }` at `lib/world/tick.ts:774/860`). Gov consumption boost folds at the shared
civilian-demand chokepoint (`consumptionRate`/`capacityGoodRates`, threading government type) so
band, planner demand, and cover chip all see it. `PROVISION_MARGIN` (0.10–0.15) on capacity
targets; feedback backstop (rationing ≥ 2 pulses ⇒ structural, with funding-bound and suppression
exclusions); response pacing (2-pulse proposal persistence + `BUILD_RATE_CAP` ≈ 0.4); structural
exporters drawable to a separate strategic export-reserve floor (non-producers keep the anchor floor). New per-(system, good)
squeeze/proposal counters persist on `WorldMarket` (missing ⇒ 0), mirroring PR1's satisfaction
field. Harness: burst-build metric (max levels committed per good per pulse — runner-loop
instrumentation, not final-world).

Timing contract: directed logistics remains after economy/population in the tick. Imports arriving
on a logistics pulse change stock immediately but affect satisfaction/unrest at the next economy
assessment, never retroactively. Add an end-to-end ordering test; PR6 labels Needs as the latest
assessment so this deliberate one-pulse lag is visible rather than looking stale.

- **Status: shipped** — PR #199 (`d797c1b`).
- Consumes from PR1: persisted `satisfaction` (squeeze = satisfaction < 1 for the pulse),
  `RATION_COVER`; from PR2: the funding-bound signal (shared exclusion logic). Structural
  exporters retain a separate strategic export-reserve floor; they are never drawn to two cycles.
- **Superseded by PR5:** the backstop's suppression exclusion lands here system-wide, which locks
  every striking system out of all build proposals. PR5 scopes it to the shortfall it explains.

### PR4 — Population, housing, colony headroom (§3)

Growth `rate × pop × (1 − D) × crowd(r)` — logistic headroom term deleted, `crowd(r)` brakes 1 → 0
over `r ∈ [1.0, CROWD_BRAKE_END 1.15]`; bounded crowding unrest pressure (clamp 0.05);
overshoot-death gated above the strike threshold (0.65); autonomic housing flips to pressure relief
(build at r > 0.95 sized to r ≈ 0.92, fed gate stays, calm gate dropped for relief,
`SETTLE_MARGIN` pre-provision retired, `plannedHousingUnits` round-up docstring rewritten); colony
establish bundles +1 housing level where habitable land permits. Guard: `crowd(r)` at popCap ≤ 0
reads fully crowded (no Infinity/NaN). Harness: population saturation watch inverts (pop ≈ popCap
healthy; pathology = r pinned at brake with relief blocked); migration-throughput metric.

Unrest integration becomes regime-sensitive while keeping goods and tax pressure separate:
Supplied systems recover faster toward their tax-supported equilibrium, Rationing accumulates
gradually, and Shortage accumulates faster. Preserve monotonicity, the tax equilibrium, and the
one-bad-pulse-is-recoverable rule. Add an end-to-end recovery test where Needs becomes Supplied
immediately but stored unrest then declines at the calibrated recovery rate.

- **Status: shipped** to `feat/band-reconciliation` at `1789c9a` (2026-07-27).
- Consumes from PR2: `VACANCY_SLACK` (relief target 0.92 sits inside it — asserted in a test).
- **Superseded by PR5:** the `+1` colony housing level (PR5 sizes housing to the seed instead,
  putting colony establish inside the vacancy slack by construction). The regime-sensitive unrest
  integration still stands as built — PR5 parked its replacement, so the worst-good fold plus
  unbounded gains remains shipped behaviour until the necessity-weighting slice lands.

### PR5 — Collapse containment, colony survival, planner unblocking (§3, §4, §5, §2 suppression)

The simulation half of what was one PR5. Scoped by a post-PR4 diagnosis: the shipped constants
compound rather than correct, and the resulting galaxy is not one the presentation layer should be
built against. On the 3000-tick equilibrium run at `1789c9a`: median price 1.94× base (target ≈ 1.0),
tier-1/2 goods at ~0 cover with 50–77% of markets pinned empty, mean unrest 0.721, **371 of 570
developed systems striking**, 262 systems collapsed to ≈ 0 buildings, and **246 colonies holding
population at `popCap ≈ 0`**. Six changes, all sim-side, in the order they cut the loop:

1. **Demand-weighted rate regime** (§3) — **PARKED, not shipped.** A summed-demand-share fold cannot
   separate a water failure from the barren-chronic deficit at any threshold, measured against the
   real 26-good basket — because the shares are unweighted. The replacement primitive is
   `docs/planned/necessity-weighted-unrest.md`; spec §3 points at it and it is its own slice.
2. **Regime unrest ceilings** (§3) — **PARKED with (1).** The containment guarantee is a claim about
   the pair; ceilings under the shipped worst-good fold would assert a protection that does not hold.
3. **Proportionate unrest-collapse channel** (§5) — one level per run per *system* (not per building
   type), severity scaling with distance above θ, and housing floored at resident occupancy so
   `popCap = 0` with residents is unreachable.
4. **Colony housing sized to seed** (§3, §5) — drop the bundled `+1` level; `ceil(seedPop ÷
   POP_CENTRE_DENSITY)` sits inside the vacancy slack by construction. This *replaces* the
   previously-planned "exempt housing from the idle channel" resolution, which is not built.
5. **Colony founding stock endowment** (§4) — `colony_establish` carries cover on the seed's real
   demand basket, drawn and conserved from the founding system's stock like the seed population.
6. **Suppression exclusion scoped to the shortfall it explains** (§2) — per (system, good), applying
   only to the capacity-vs-realized gap and never to demand-vs-capacity; plus exporter spare counted
   on realized rather than latent output.

Harness: striking share and stranded-population (`popCap ≈ 0` holding population) become headline
metrics, plus founding-stock opening satisfaction; the §8 collapse/colony assertions land here.
Treasury recalibration (§8) belongs to this PR since it moves the equilibria — measured as flat, no
retune needed. The unrest/tax half of §8 is parked with items 1–2, having nothing to recalibrate.

- **Interim incoherence (until PR6):** the panels still speak percentages, not regimes, and still
  name Strike at the presentation boundary rather than 0.65.

### Necessity-weighted unrest — the parked unrest lever (before PR6)

`docs/planned/necessity-weighted-unrest.md`. Necessity becomes its own authored per-good table
(`GOOD_NECESSITY`) weighting each good's demand share in the dissatisfaction fold, plus a per-good cap
on how much unrest one good can ever contribute. It replaces PR5 Task 1's summed-demand-share fold —
the weight is what that fold was missing — and lands PR5 Task 2's regime ceilings as optional
tidy-up rather than a co-requirement, since the per-good cap does the containment job at finer grain.
The same pass deletes `GOVERNMENT_TYPES.consumptionBoosts`, a flat population-independent term that
dominates a small colony's demand basket.

Demand itself does not move: pricing, bands, the ration threshold, logistics, the planner and decay
are untouched. An earlier draft of this slice proposed necessity as demand *elasticity* (demand
contracting under scarcity); that framing was reviewed, found to break the glut/decay signal, pricing,
the logistics deficit gate and the build planner, and abandoned.

**Sequenced before PR6, not after.** PR6's chips name regimes, and this slice is what settles what a
regime means — the same reason presentation was split out of PR5.

### PR6 — Regime presentation + docs fold (§6, §7 UI)

Regime classifier (Supplied/Low reserve/Rationing/Shortage/Glut) as a pure engine helper on the shared
constants with `RATION_EXIT_EPS` hysteresis and the §6 precedence rules; regime chips everywhere a
good appears (the `HEALTH` record in `industry-panel.tsx:53-57` is the structural template); Worked
column splits into Staffed + state chip; needs severity re-bases (`needSeverity`'s 0.95/0.5 bands →
regime constants); population occupancy bar gains overshoot treatment + crowding chip; days-of-cover
becomes the primary unit. **UI gets the house collaborative wireframe pass (browser-viewable HTML
prototype, breadth-first) before implementation.** Harness: regime-share metric (% of (system,
good) pairs per regime in the simulate report); shock-recovery-tail read; `computeCoverLevels`
excludes structural exporters. Docs fold ON THE BRANCH before the final review: spec →
`docs/active/`, SPEC.md + `economy-equilibrium-rework.md` updated, `economy.ts:168` doc pointer
fixed, `[L]` BACKLOG item deleted, these build files deleted, maturity-spread memory note
re-audited.

The Population stability surface also explains the stored integral: current goods pressure,
current tax pressure, and rising/stable/recovering direction, with a coarse recovery indication
rather than a precise forecast. Keep diagnostics visible when `popCap <= 0` but population or
unrest remains; align the Strike label with the real 0.65 production-suppression threshold; and
label Needs as the latest economy assessment. The regime re-base retires the legacy 95% “met”
cutoff, so any active rationing is named consistently.

- Consumes from PR5: the collapse/colony behaviour the panels describe, **and** the settled
  regime/unrest constants the chips name. PR5 parked that fold, so those constants are NOT settled
  yet — the necessity-weighting slice below must land first. Building the panels against the shipped
  worst-good regime would mean naming states the simulation is about to redefine, which is the reason
  presentation was split out of PR5 in the first place.

## Cross-PR interfaces (locked here so plans don't drift)

| Interface | Producer | Consumers | Shape |
| --- | --- | --- | --- |
| `RATION_COVER` | PR1, `lib/constants/economy.ts` (`ECONOMY_CONSTANTS.RATION_COVER = 2`) | PR1 civilian/input draws, PR3 backstop, PR6 regimes | demand cycles |
| `consumptionFactor(stock, rationStock)` | PR1, `lib/engine/tick.ts` | supply-chain, flat tick, PR6 classifier | pure fn → [0,1] |
| initial/export reserve policy | PR1 seed / PR3 logistics | world-gen and structural exporters | separate from rationing; initially 0.75 × T |
| `productionCeiling(stock, targetStock, holdCover)` | PR1, `lib/engine/tick.ts` | supply-chain, flat tick, **PR2 selling factor**, PR6 Glut | pure fn → [0,1] |
| `WorldMarket.satisfaction?: number` | PR1 economy pulse (missing ⇒ 1) | pop-needs read, fed-proxy, PR3 squeeze counters, PR6 chips | optional field, no save-version bump |
| `SimulatedMarketEntry.delivered` | PR1 supply-chain | economy processor satisfaction measure | `number` per entry |
| `sellingFactorBySystem` signal | PR2 economy pulse | decay processor, `buildIndustryReadout` (recomputable read-side — stock+band only) | `Map<systemId, Map<goodId, number>>` |
| funding-bound signal (unmet funded deficits) | PR2 logistics matcher | PR2 decay exclusion, PR3 backstop exclusion | shape decided in PR2 plan |
| `WorldMarket` squeeze/proposal counters | PR3 economy/build pulses (missing ⇒ 0) | PR3 backstop + pacing | optional fields |
| realized/suppressed production for planners | PR3 (`realizedProductionBySystem` + persistence) | `toGoodMarketStates`, matcher, backstop | threaded via planner rows/ctx |

## Validation strategy

Per-PR: `npx vitest run` green (invariance bridges included — all knees are band-relative, so
`ECONOMY_SCALE` ratio-invariance holds by construction; S=1 magnitudes shift, fixtures update,
assertions stay range-y), `npx next build --webpack`, and a coarse `npm run simulate` read scoped
to what has landed (each PR plan names its expected/deferred symptoms). Full §8 validation targets
(no pops-short at rest, median price/base ≈ 1 with two-sided dispersion, stable housing, no burst
builds, glut prunes, colonies populate, no NaN/runaway/pinning) are judged **after PR5** — PR4's
resting state is a compounding one, so its numbers measure the defect, not the design — and the
regime-share metric (PR6) becomes the permanent instrument. PR5 additionally holds the headline
striking-share and stranded-population reads.
