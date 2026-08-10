# Abandonment — working file

Transient working file for ROADMAP item 6's abandonment step (design context:
[supply-response.md](../planned/supply-response.md), "Struck worlds resolve"). Currently carries the
prerequisite measurement: **are the stuck worlds starving and shrinking, or fed and just small?**
Deleted when the item ships.

## Evidence

### Claim (pre-registered, before the instrument ran)

The stuck worlds at equilibrium — the chronically striking cohort and the parked pop 10–100
worlds — are **fed and just small**: held at near-constant population by the housing crowd brake,
not starving (their supply shortfall D is small) and not in sustained decline.

This is the supply-response doc's own untested "crowd-brake equilibrium" hypothesis, stated as a
claim so it can lose.

### Falsifier (committed before the instrument ran)

The claim is **false** if, at equilibrium (t = 10,000), **any** of:

1. ≥ 50% of the chronically striking cohort reads D ≥ 0.10 while crowdFactor > 0.9 — growth cut by
   shortfall with housing not binding (a starving fixed point);
2. the chronically striking cohort's median trailing-window population change ≤ −5% — they are
   shrinking, not parked;
3. ≥ 50% of the parked pop 10–100 cohort is shortfall-held rather than crowd-held (definitions
   below).

Falsified means: the stuck worlds are starving and/or shrinking, the crowd-brake explanation is
dead, and abandonment designs against a live dying cohort.

### Pre-registered definitions and conditions

- **Conditions:** 600 systems, seed 42, `ECONOMY_SCALE` 100 (the defaults — Gate 2 conditions).
  Horizons: startup t = 1,000 and equilibrium t = 10,000; both are read, the claim is judged at
  equilibrium (what parks a world is a steady-state question; startup is read alongside for the
  founding story).
- **Trailing window:** last 50 cycles (1,200 ticks) before the equilibrium horizon, last 25 cycles
  before the startup horizon, sampled once per cycle (`CYCLE_LENGTH` 24).
- **Chronically striking:** unrest ≥ `STRIKE_PARAMS.threshold` (0.65) in ≥ 80% of trailing-window
  samples — the trailing-window rule, because instantaneous striking count is churn, not health.
- **Parked:** |net population change| < 2% across the trailing window, and present (pop > 0) at the
  window start — a world founded inside the window is growing, not parked.
- **Binding growth brake** (read at the horizon): cf = `crowdFactor(pop, popCap, 1.15)`;
  sf = 1 − D, with D from the harness's own `perSystemSupplyState` fold (the same read Gate 2's
  numbers came from). **Crowd-held:** cf < sf and cf < 0.95. **Shortfall-held:** sf < cf and
  sf < 0.95. **Unbraked:** both ≥ 0.95.
- **Starving:** D ≥ 0.10 (Provision below the Supplied line). **Sustained decline:** trailing-window
  net change ≤ −5%.
- **Secondary readings** (recorded, not claim-bearing): the viability raw-field distribution over
  the stuck cohorts — total extractor slot cap, arable slots, habitable space — as input to the
  future `canSustainItself` predicate; emptied count (pop < 1) and popCap ≈ 0 count, both horizons.

### Instrument validation anchors (pre-registered)

Same seed and conditions as Gate 2, so before reading anything the instrument must roughly
reproduce: settled ≈ 582 at equilibrium, instantaneous striking ≈ 15 (2.6%), regime split
≈ 89.3 / 7.0 / 0.7 / 2.9 (Sup/Str/Rat/Sho). Approximate, because HEAD carries post-Gate-2 review
fixes; a mismatch beyond a few systems means suspect the instrument first.

### Reading (2026-08-10, instrument `temp/stuck-worlds-diag.ts`, gitignored)

```
Meaning:    The fork was a false dichotomy. The chronically striking worlds are starving but NOT
            shrinking — permanent famine worlds held at exactly their housing cap by conserved
            colonist inflow replacing their dead every cycle — while the broader parked
            small-world cohort is mostly fed and crowd-held, exactly as the hypothesis said. A
            decline-keyed abandonment trigger would never fire on today's galaxy.
Claim:      Stuck worlds are fed and just small — crowd-brake-held, not starving, not declining.
Number:     F1: 11/11 (100%) chronic strikers read D ≥ 0.10 with crowdFactor > 0.9 — falsifies
            (threshold ≥50%). F2: their median trailing-window trend −0.00% — holds (≤ −5%
            falsifies). F3: parked pop 10–100 shortfall-held 10/49 = 20.4% — holds (≥50%
            falsifies). Verdict: FALSIFIED on F1.
Horizon:    both. Startup (t=1,000): zero chronic strikers, zero parked small worlds — the
            phenomenon does not exist yet (founding cohort still growing). Equilibrium
            (t=10,000): everything below. Claim judged at equilibrium as pre-registered.
Cohort:     chronic strikers (unrest ≥ 0.65 in ≥80% of 50 trailing cycle samples): n=11 of 582
            settled. Parked pop 10–100 (|trend| < 2%): n=49. Stuck union: n=51. Seed 42, 600
            systems, scale 100 — one galaxy's draw.
Licenses:   SUPPORTS: (1) a sustained-physical-decline abandonment trigger never fires today —
            the decline it would watch for is continuously masked by refill; (2) the strikers
            are permanent famine worlds (D 0.48–0.58, Shortage regime, unrest pinned at 1.00,
            pop == popCap exactly, all with slotArable = 0); (3) the modal parked small world is
            healthy (39/49 crowd-held, median D 0.051) — "parked" alone is not a defect; (4) the
            drafted three-way canSustainItself test (no deposits ∧ no arable ∧ nothing to build
            on) marks 0 of 51 stuck worlds — every one has deposits (extractor slots 130–1,048)
            and habitable space (2.3–11.3); the discriminating lack is arable alone (51/51).
            DOES NOT SUPPORT: which inflow path does the refilling — colonist delivery vs
            migration is unattributed (both are headroom-capped, which is why refill stops at
            exactly popCap; delivery's ascending-population water-fill with no provision/unrest
            gate is the shape that matches, receipt below). Does not license calling the
            strikers unviable — they have deposits and space; their famine is a logistics
            outcome (no local food, imports failing), not "nothing there". Does not license any
            unviable-world count (the predicate is still undesigned). Band shares from this run
            are not quotable as the galaxy state (validation note below).
```

**Mechanism receipts** (the arithmetic behind Meaning): at the strikers' readings,
`populationDelta` (`lib/engine/population.ts`) nets growth 0.015·pop·1.00·(1−≈0.5) ≈ +0.75%/cycle
against decline 0.015·pop·1.00 = −1.5%/cycle → ≈ −0.75%/cycle intrinsic, ≈ −31% over the 50-cycle
window; observed −0.00%. The refill paths are conserved and headroom-capped: `allocateColonists`
water-fills each faction's pool across developed systems by ascending population, capped by
`popCap − population`, with no provision/unrest/viability gate
(`lib/engine/colonist-delivery.ts:97-135`); migration is `destHeadroom`-gated
(`lib/engine/migration.ts`). Housing decay never tears below occupancy
(`lib/engine/infrastructure-decay.ts:157-162`), so popCap tracks pop — jointly pinning pop at
exactly popCap. Net effect: each striker consumes ~0.75%/cycle of its population in colonists
drawn from healthy worlds, forever.

**Validation:** startup anchors matched near-exactly (settled 253 vs Gate 2's 253; regimes
81.4/7.1/9.9/1.6 vs 80.6/7.9/9.9/1.6) and equilibrium settled matched exactly (582). Equilibrium
regime mix deviates (Strained 11.3% vs 7.0%; striking-now 12 vs 15): Gate 2 measured the
pre-review arm, and three major review fixes landed between that measurement and the shipped
merge, so drift is expected. The claim verdict rests on per-world attribution, not band shares;
this run's band shares should not be quoted as the galaxy state.

### Raw output (verbatim)

```
scale=100 systems=600 seed=42 ticks=10000 cycle=24 strikeT=0.65 brakeEnd=1.15

STARTUP — t=1000, window [400, 1000], 25 cycle samples
VALIDATION: settled=253 (readings 253)  striking-now=0 (0.0%)
  regimes: Sup 81.4%  Str 7.1%  Rat 9.9%  Sho 1.6%
  emptied (pop<1)=0  popCap≈0 with pop>0=0
CHRONIC STRIKERS (striking in ≥80% of window samples): n=0
PARKED (|window trend| < 2%, present at window start): n=11 of 253 settled
  pop >=1K     n= 11  crowd-held   8  shortfall-held   0  unbraked   3  median r=1.03  median cf=0.88  median D=0.000  median unrest=0.07
PARKED pop 10-100 detail: n=0
FALSIFIER LINES (STARTUP): F1 0/0  F2 NaN  F3 0/0 → claim holds on this horizon

EQUILIBRIUM — t=10000, window [8800, 10000], 50 cycle samples
VALIDATION: settled=582 (readings 582)  striking-now=12 (2.1%)
  regimes: Sup 86.3%  Str 11.3%  Rat 0.2%  Sho 2.2%
  emptied (pop<1)=0  popCap≈0 with pop>0=0

CHRONIC STRIKERS (striking in ≥80% of window samples): n=11
  name                         pop    popCap      r     cf      D      P unrest   trend%  strk%      held    regime xslots arable    habit
  Cascade-2                   20.0      20.0   1.00   1.00  0.480  0.520   1.00    -0.00    100 shortfall  shortage  477.9      0      2.4
  Aegis-4                     20.0      20.0   1.00   1.00  0.492  0.508   1.00    -0.00    100 shortfall  shortage  177.5      0      3.2
  Aegis-5                     20.0      20.0   1.00   1.00  0.492  0.508   1.00    -0.00    100 shortfall  shortage  367.9      0      4.2
  Aegis-18                    20.0      20.0   1.00   1.00  0.503  0.497   1.00    -0.00    100 shortfall  shortage  130.5      0      2.3
  Nexus-3                     20.0      20.0   1.00   1.00  0.480  0.520   1.00     0.00    100 shortfall  shortage  207.0      0      3.7
  Nexus-8                     20.0      20.0   1.00   1.00  0.480  0.520   1.00     0.00    100 shortfall  shortage  854.6      0      6.5
  Nexus-12                    20.0      20.0   1.00   1.00  0.480  0.520   1.00     0.00    100 shortfall  shortage  319.4      0      5.7
  Citadel-16                  20.0      20.0   1.00   1.00  0.497  0.503   1.00     0.00    100 shortfall  shortage  504.8      0      2.7
  Citadel-15                  79.9      80.0   1.00   1.00  0.582  0.418   1.00    -0.07    100 shortfall  shortage  707.3      0      4.0
  Solace-29                  100.0     100.0   1.00   1.00  0.582  0.418   1.00     0.04    100 shortfall  shortage 1047.6      0      6.0
  Solace-20                  219.7     220.0   1.00   1.00  0.496  0.504   1.00    -0.12    100 shortfall  shortage  969.1      0     11.3

PARKED (|window trend| < 2%, present at window start): n=482 of 582 settled
  pop 10-100   n= 49  crowd-held  39  shortfall-held  10  unbraked   0  median r=1.10  median cf=0.22  median D=0.051  median unrest=0.20
  pop 100-1K   n=100  crowd-held  96  shortfall-held   4  unbraked   0  median r=1.11  median cf=0.19  median D=0.020  median unrest=0.17
  pop >=1K     n=333  crowd-held 332  shortfall-held   1  unbraked   0  median r=1.12  median cf=0.09  median D=0.000  median unrest=0.09

PARKED pop 10-100 detail: n=49
  starving (D≥0.10): 18 (36.7%)
  striking chronically: 9

VIABILITY RAW FIELDS over stuck (chronic ∪ parked 10-100): n=51
  no extractor slots: 0   no arable: 51   habitable ≤ 0: 0   all three: 0

FALSIFIER LINES (EQUILIBRIUM):
  F1 chronic strikers with D≥0.10 ∧ cf>0.9: 11/11 = 100.0%  (falsifies at ≥50%)
  F2 chronic strikers' median window trend: -0.00%  (falsifies at ≤ −5%)
  F3 parked 10-100 shortfall-held: 10/49 = 20.4%  (falsifies at ≥50%)
  → EQUILIBRIUM: CLAIM FALSIFIED on this horizon
```

### Outcome

**Falsified** (on F1; F2 and F3 held). The stuck worlds are neither of the fork's two answers: the
strikers are **starving and perpetually refilled**, the parked small cohort is fed and crowd-held.
Direction, one sentence, for the spec to own: abandonment's trigger cannot key on population
decline (the delivery/migration pump masks it structurally) — the design has to either gate the
pump away from doomed worlds or key on sustained famine-state directly, and the three-way
viability test as drafted identifies none of the worlds actually stuck.

Open follow-up measurement if the spec needs it: attribute the refill between colonist delivery
and migration (needs a processor hook counting per-system inflow by path).

## Spec (owner-decided scope, 2026-08-10 — deliberately minimal)

**Headline.** Two small rules, nothing else. (1) People stop moving **into** famine worlds — no
colonist delivery, no inbound migration; leaving is unaffected. This un-masks real decline on
doomed worlds. (2) A world in famine whose population has collapsed below one pop (under a
million people on a whole world) is over: its remaining pops are removed, its buildings deleted,
and the system resets to unclaimed, factionless frontier — claimable and colonisable again
through the existing paths. Everything in between — a world that shrinks, rebalances at a tiny
size and stabilises — is left alone by design: the maths self-balances (shrinking demand raises
satisfaction), a tiny stable outpost is legitimate negative space, and buying one out of its rut
is the relief item's business. Both rules are explicitly temporary scaffolding until the
logistics pass unifies people-movement, and both are deliberately un-tuned: no windows, no new
thresholds, one constant.

### Rule 1 — the famine inflow gate (delivery AND migration)

A system currently in survival shortfall (`SupplyState.survivalShortfall` — a demanded survival
good below `SHORTAGE_SATISFACTION`, the same bit that bands a world Shortage) receives no
population inflow that cycle, by either path: it is skipped as a colonist-delivery sink, and
diffusion migration moves nothing toward it (an edge whose more-attractive endpoint is a famine
world moves nothing; outflow from a famine world is unaffected). Owner's rule, stated plainly:
people do not move to famine worlds. Recovery re-includes the world automatically next cycle; no
persisted state, no window, no threshold constant.

- Wiring: economy runs at cycle start and produces `supplyStateBySystem` (economy block
  `lib/world/tick.ts:851-866`); migration (which owns the delivery pass) runs later in the same
  tick body (`:984`) — pass the famine set into the migration processor's params. Delivery and
  economy are gated by the same cycle-start predicate, so delivery can never run on a tick where
  the signal is absent (verified at review: `cycleStartShard`, `lib/tick/processors/migration.ts:29-31`).
- Implementation shape (review finding — do not deviate): `allocateColonists` keeps `sinks`,
  `contributions` and `added` index-aligned with the faction group
  (`lib/engine/colonist-delivery.ts:120-134`), so famine systems are **not filtered out of the
  array** — they get an eligibility flag on `ColonistSystem` that forces `headroom: 0`.
  Conservation holds unchanged.
- Donation and outbound flow are untouched: a famine world above `minSourcePopulation` still
  donates idle spare, and migration away from a famine world still runs (that outflow is exodus,
  which is wanted).
- Why migration needs the gate too (review finding): its liveability score does NOT categorically
  avoid famine worlds — an under-staffed famine world's jobs term is positive
  (`lib/engine/migration.ts:49-58`), and what stops refill today is only `destHeadroom = 0` plus
  delivery drinking the freed headroom first (`lib/tick/processors/migration.ts:38-40`). Rule 1
  on delivery alone would hand that headroom to diffusion on the same tick. Rather than testing
  whether diffusion takes over, the owner closed it by rule: no inflow, either path.

### Rule 2 — the death line

At the population processor's cycle resolution: if a system is in survival shortfall **and** its
(post-delta) population is below `ABANDON_POP_FLOOR = 1` — one pop, i.e. under a million people
on a whole world, the "very underpopulated" line the owner named — the colony is over. The
processor reports it; the tick body (the sole owner of `control` writes) applies the reset, which
is a genuine reset-to-frontier ("back to default with no faction"), not a mothballing:

- `population → 0`, `unrest → 0`, `collapseDebt → 0` (an explicit zero — `TickSystem` requires
  the number, `lib/tick/rows.ts:44`), `provisionExpectation` deleted (the
  stale-memory-must-not-survive-resettlement rule the expectation item already stated);
- `factionId → null`, `control → "unclaimed"` — ordinary claimable frontier again via the
  existing claim (`applyClaims`, `lib/world/tick.ts:454-461`; unclaimed test `:1074`) and
  colony-candidate (`:1092-1102`) paths; no new resettlement machinery;
- **buildings cleared** (`buildings` emptied, `buildingIdleCycles` cleared, `popCap → 0`).
  Review-verified necessity, not a choice: infrastructure decay runs only on developed systems
  (the economy adapter's key set — `lib/tick/adapters/memory/economy.ts:45-53`,
  `lib/engine/control.ts:10-11`), so left standing they would freeze forever and hand any
  resettler a fully-built free colony (`applyDevelopments` takes
  `max(popCap, housingPopCap(buildings))`, `lib/world/tick.ts:509-511`);
- market rows stay (the warehouses affordance is real — `addMarketsForSettledSystems` adds only
  missing rows, `lib/world/tick.ts:529-555`), but their demand-derived fields reset in the same
  write: `demandRate → MIN_DEMAND`, `honestUseRate`/`squeezeCycles`/`logisticsFundingBound`
  cleared, `productionSuppressed → false`. Stock is what remains. Without this a resettled 2-pop
  colony spends its first cycle priced and rationed as the dead 20-pop world
  (`targetStock = TARGET_COVER × demandRate`, `lib/engine/market-pricing.ts:63`);
- open `build` construction projects targeting the system are dropped in the same application —
  otherwise the former owner keeps funding invisible construction on a world it lost
  (`fundQueue` re-checks nothing, `lib/engine/construction.ts:96-125`; the UI hides the project
  the moment `factionId` is null, `lib/services/construction.ts:178-180`);
- no save-format change: every touched field already exists and `control`'s union is unchanged
  (round-trip verified at review against `mergeSystemsIntoWorld`, `lib/world/tick.ts:233-259`).

Founding safety: seeds open at 2 pops with the famine conjunct still required — a newborn crosses
the floor only after ~90 consecutive cycles of unbroken famine with the delivery gate refusing it
settlers the whole way, which is a genuinely dead colony, not an unlucky opening. Famine remains
readable all the way down (review-verified: consumption is strictly linear in population with no
floor, and `hasSurvivalShortfall` needs only `demanded > 0` — `lib/engine/physical-economy.ts:54-60`,
`lib/engine/population.ts:208-214`).

The floor is a **backstop, not a mercy kill** — with decline proportional to remaining population
it fires only after deep collapse. At the measured striker decline (−0.75%/cycle) a pop-20 world
reaches the floor in ≈400 cycles (≈9,600 ticks), just inside the equilibrium horizon; the earlier
0.1 floor was unreachable within ~17,000 ticks and additionally invisible to every instrument —
`ABANDON_POP_FLOOR = 1` deliberately coincides with the harness's existing `emptiedCount` line
(`population ≤ 1`, `lib/tick-harness/population-analysis.ts:151,169`) so the gate's instrument
measures the trigger's own definition.

### Invariants and consumers

- The developed-gate invariant test (`lib/world/__tests__/developed-gate-invariant.test.ts`) is
  re-authored, not just re-commented — review finding: only its population assertion survives.
  (1) non-developed ⇒ population 0: **holds** (the reset zeroes pop in the same application as
  the control flip). (2) "non-developed market stock unchanged from seed" and (3) "no flow event
  references a non-developed system" both become false statements once husks exist (a husk keeps
  market rows; `flowEvents` retain 200 ticks of history naming it). Both re-scope to
  **never-developed** systems, distinguishable without new state: a never-developed system has no
  market rows by construction (`lib/world/tick.ts:520-527`). A constructed transition unit test
  (drive a famine world below the floor, assert the full reset end-state) is added beside it.
- A declining world that still holds population stays `developed`, so it keeps decaying,
  producing and being read normally — there is nothing to engineer for the in-between state
  (owner call: "might or might not decay" is fine; no special handling).
- The harness's settled denominator (`control === "developed"`) drops the world automatically at
  the reset — the "emptied world reads Supplied forever" trap closes structurally. Known reads
  accepted as-is (owner call, no new harness surface): `build-analysis` will count a resettled
  husk (fresh rock + old warehouse stock) as a founded colony; fine at this scale.
- Verification, deliberately light (owner call — "resetting props when a value crosses a line
  does not need exhaustive testing"): the constructed transition unit test (red-proofed, per
  standing convention), the re-authored invariant test, and one rerun of the existing
  `temp/stuck-worlds-diag.ts` to see the strikers' trailing trend go negative and the startup
  founding cohort stay healthy. No new harness counters, no extra checkpoint ceremony; if the
  death line takes thousands of cycles to first fire in the wild, that is accepted — the rule is
  correct independent of how often it triggers.

### Design decision from the measurement review (owner call, 2026-08-10)

- Migration's code is untouched. (Corrected at spec review: the original rationale here — "it
  already scores liveability and avoids famine worlds" — overstated the mechanism. Its score does
  not categorically avoid famine worlds (the jobs term can pull); what protects them today is
  zero destination headroom plus delivery running first. Whether diffusion refills them once the
  gate frees that headroom is a gate-tested expectation, stated under Rule 1.) The blind path is
  colonist delivery's emptiest-first, headroom-only water-fill (receipts above). Delivery was
  added deliberately (`f817be76`) because one-hop diffusion cannot reach the multi-hop frontier.
- **The fix here is the minimal famine gate: delivery skips worlds currently in survival
  shortfall.** One condition on the sink list, no new state, no thresholds. Explicitly temporary
  scaffolding — kept as simple as possible on purpose.
- The real fix — unifying diffusion migration and colonist delivery into one routed
  people-movement system alongside goods — is booked to the logistics-pillar depth check
  (ROADMAP, Unqueued). Do not grow the interim gate toward it (no appeal-weighted allocation;
  that was considered and set aside as overworking a system the logistics pass replaces).

## Post-implementation verification (2026-08-10, `8eb266e4`, `temp/stuck-worlds-diag.ts` rerun)

Same conditions as the Evidence run (600 systems, seed 42, scale 100, both horizons). Before → after:

- **The refill is dead and decline is unmasked.** Chronic strikers 11 → 5; the three remaining
  famine strikers now decline at **−30.7% per 50 cycles** (before: −0.00%, pinned at popCap) and
  sit at r = 0.13–0.72 — the death spiral runs. At the measured rate the first (pop 2.6 at t=10k)
  crosses the 1-pop line around t≈13k; no abandonment fires inside 10k, as the spec's own
  arithmetic predicted and the owner accepted.
- **The parked small cohort is clean.** Parked pop 10–100 shortfall-held 10 → 0 (all 34 now
  crowd-held); starving-parked 18 → 6. Sick worlds are no longer "parked" — they are dying.
- **Founding untouched.** Startup horizon: 253 settled, regime split 80.6/7.9/9.9/1.6, zero
  emptied, zero famine newborn deaths.
- **Galaxy slightly healthier at equilibrium:** Shortage share 2.2% → 1.2%, striking-now 12 → 8.
- **Known accepted edge, observed once:** 1 settled world at pop < 1 that is not in famine (its
  tiny demand is now met, so it calmed below the floor and the conjunct never fires) — the
  "shrinks and balances itself" ghost the owner explicitly accepted; relief's business later.
- Two non-famine chronic strikers remain by design (rationing-regime worlds, one at pop 2,280 with
  arable land): the famine gate correctly does not touch them — they are the relief item's cohort.

## Spec review record (single-agent adversarial pass, opus, 2026-08-10)

Owner chose one adversarial agent over the full multi-agent `/spec-review` (cost call; narrow
surface). All findings folded into the spec above in the same session. Summary, worst first:

1. **Blocker — husk decay didn't exist.** Infrastructure decay runs only on developed systems, so
   "ruins rot naturally" was false: buildings would freeze forever and resettlement inherited a
   free fully-built colony. Fix: the reset clears buildings/`buildingIdleCycles`/`popCap`.
2. **Blocker — the 0.1 floor was unreachable and unobservable.** ≈706 cycles (≈17k ticks) at the
   measured decline — beyond both horizons — and no instrument would have reported a fire. Fix:
   floor = 1 (coincides with `emptiedCount`'s existing line and the owner's own "under a million
   people" fiction anchor); abandoned/husk counters and a constructed transition test added.
3. **Major — the developed-gate invariant did not "survive as stated":** its market-stock and
   flow-event assertions break once husks exist; re-scoped to never-developed systems.
4. **Major — the migration rationale was an unverified claim** (this file's own Evidence said
   unattributed); restated as a gate-tested expectation with the correct mechanism.
5. **Major — stale market fields:** a resettled colony would spend its first cycle priced as the
   dead world; demand-derived market fields now reset with the system.
6. **Minor — orphaned construction projects** billed to the old faction; dropped at reset.
7. **Minor — four stale line citations** inherited from supply-response.md; corrected.
8. **Minor — two harness reads** (`summarizeInfrastructure`, founding-cohort classification)
   noted in Invariants-and-consumers.
9. **Minor — reset details:** `collapseDebt` is an explicit 0; same-tick re-claim is possible and
   accepted as harmless.

Review also positively verified (do not re-test): famine is readable at any population > 0;
Rule 1's wiring is in scope and cannot run ungated; treasury/maintenance drop a husk
automatically; relations, directed logistics, save round-trip and events all handle the reset
state; the tick body is the sole `control` writer.
