# How should pricing affect internal logistics?

**Status: direction agreed 2026-08-03 (see "Direction" below); measurements before spec.** The
original open question is settled in shape; this file now carries the agreed direction and the
evidence, and stays alive as the working file until the work ships.

Transient (build-plan lifecycle): delete when the question is settled, carrying the decision into
`docs/active/gameplay/economy-autonomic-agency.md` and anything killed into the `killed-designs` memory.

---

## The question in one line

Two thresholds that gate *physical* logistics behaviour — when a world stops producing, and when it is
willing to give goods away — are both measured against a **pricing** reference, and nobody chose that.

## Why it is a question at all

There are two different "how much should sit here" numbers, and they answer different questions:

| | What it means | Denominator |
|---|---|---|
| `targetStock` | the **price** anchor — where the good prices at par | `demandRate`, floored at `MIN_DEMAND` |
| `logisticsTarget` | the **warehousing** target — what this world tries to keep on hand | real demand, unfloored |

`MIN_DEMAND` is a divide-by-zero guard whose own docstring calls it a floor on the *pricing*
denominator. It was never authored to describe need.

#211 moved the **deficit** side (who needs goods) onto `logisticsTarget`. Of the two readers left on
the price anchor at that point, one remains and is the subject of this question:

- **The production brake** — `productionCeiling` stops output at `HOLD_COVER × targetStock`.
- ~~**The generosity rule**~~ — shipped out in #212 (`DONOR_RESERVE_COVER`); the item-5 role split
  then removed the anchor from the logistics data path entirely (`GoodMarketState` no longer carries
  `targetStock`; `surplusDrawable`'s dead `targetStock ≤ 0` guard is deleted).

## What is measured

From [hold-cover-surplus-margin.md](./hold-cover-surplus-margin.md) — 600 systems, seed 42,
`ECONOMY_SCALE=100`, 10,000 ticks, counted inside the matcher, cross-checked against `flowEvents`:

- The generosity rule **does** fire: 2.91% of hauls at startup, 1.82% at equilibrium.
- 95% of those donors held stock **no delivery could have supplied** — made, not given. The roadmap's
  original premise (a self-supplier can only re-donate what it was given) is backwards.
- ~1% of ordinary-path checks sit in the gap between the brake (1.3×) and the generosity line (1.4×).

## What is NOT measured — do not build on these

- ~~**Dwell time in the gap.**~~ Measured 2026-08-03 — see the Evidence section below. Handoff for
  ~97% of visits; a small real camping cohort (industrial-input goods whose nominal demand is not
  actually drawn).
- **Why camping markets drain slowly.** The drain ratio (~0.27× nominal) is measured; the *cause*
  (downstream input-gating, strikes, idle factories) is inferred, not measured.
- **Which route lifts a market over 1.4×** — own production overshooting the brake, versus the anchor
  shrinking underneath it (an `anchorMult` event, or demand decline).
- **The other two callers of `surplusDrawable`** — the build input-supply gate and the colony founding
  manifest. Only the logistics matcher was measured. Both callers have since been re-pointed at
  demand-denominated figures (#212 and the item-5 role split), but re-pointed is not measured — no
  count of how often either fires exists.
- **Anything about what changing `HOLD_COVER` would do.** `npm run impact` puts it in
  `economy`/`industry`/`tick` — it throttles production galaxy-wide, not just this donor edge.

## Two corrections made during the discussion — keep them

Both were assistant errors caught by Kai; they are recorded because the wrong versions are plausible
and would otherwise be re-derived.

1. **Logistics does consider external need.** The matching stage is entirely driven by it — shortages
   are collected across systems, sorted worst-first, and matched to the nearest world with spare. What
   external need cannot do is move the *threshold* at which a world counts as having spare. It decides
   whether spare is used and where it goes; it cannot create spare in a world below its own line.
2. **No world has zero demand for a good.** `GOOD_CONSUMPTION` carries a per-capita civilian rate for
   every good, ore included. Stock therefore always drains and the gap is transient, not a permanent
   lock. The floor only takes over where real consumption sits under it — small worlds, and higher-tier
   goods at larger populations (~25 pop for ore, ~50 for electronics, ~167 for ship frames).

## What the discussion has to decide

Open, in rough dependency order. **No options are proposed here on purpose** — the last three times a
direction was picked before the evidence, it cost a PR.

1. Should the production brake reference the price anchor at all, or move to a demand-denominated
   figure the way the deficit, donor, and founding sides already did? (It is the last physical reader —
   the generosity rule moved in #212 and the item-5 role split took the anchor out of the logistics
   data path entirely.)
2. If it moves: what happens on markets whose real demand is under the floor? The anchor's `MIN_DEMAND`
   floor is currently what keeps the brake's knee finite there. A demand-derived knee of 0 for a pure
   exporter would make `productionCeiling` return 0 at any stock — production halted outright, the
   brake-side mirror of the donor-side trap that died with `surplusDrawable`'s guard (there, demand 0
   correctly meant *everything is drawable*; here it would mean *nothing may be produced*).
3. Should the brake and the generosity line share one owner, or is a deliberate gap between them wanted?
   The measurement kills the "it never fires" argument for collapsing them, so the case has to be made
   on design grounds instead.
4. Does price belong in the logistics decision in some *other* form — as a signal about where goods are
   wanted, rather than as the yardstick for how full a warehouse is?

## Inputs noted for the discussion (not options, not decisions)

- Kai, 2026-08-03: the matcher's sink ordering (severity = shortfall × demand, worst-first) is
  itself design space — e.g. scaling need by relative size so a tiny/new colony's request can
  outrank raw tonnage, and giving the player a mechanical lever over flow priority. Explicitly
  separable from the donor-side reserve change (which only alters how much a market may *give*,
  never who is *served* first) and not scoped into it.
- Kai, 2026-08-03 (during donor-reserve verification, prompted by the ship_frames empty-tail
  finding): the deeper problem is upstream of flow priority — colonisation is far too generous
  (the AI founds essentially everything by ~tick 500, and those colonies then leech for thousands
  of ticks: served last, growing slowly, with little capacity to lift themselves out). Direction,
  stated as opinion not decision: make colonisation resource-aware; make production planning
  consider global faction/market needs rather than purely local ones; plus the other queued fixes.
  The chronic marginality of mid-size consumers on thin chains (ship_frames especially) is a
  symptom of this, not of the logistics rules alone.
- Kai, 2026-08-03 (after the long-horizon stability read): now that monetary mechanics exist,
  **systematically remove anything that is still free.** The code marks several such quantities
  itself: the logistics work budget ("free, population-scaled in v1"), the per-pop construction
  pool base, cheap claims, a founding manifest that costs goods but no money. Colonisation in
  particular should be a major undertaking in the Stellaris mould — very expensive and resource
  intensive — which is also the structural fix for the leech-colony pattern above (founding
  everything by ~t500 stops being possible when each colony must be provisioned and paid for).
  Stated as direction; the audit itself reads roadmap-worthy and awaits Kai's placement in the
  queue.
- Kai, 2026-08-03 (post item-5 review, discussing the dead zone): the real-world hard part of
  logistics is not per-world stock thresholds but being part of a **chain** — infrastructure,
  cost, labour, distance (the Victoria 3 difficulty). A throughput/entrepôt world would *request
  more inbound when its exports hit their limit* — demand propagating upstream through hubs —
  while producers near enough to consumers ship direct. Today's greedy point-to-point matcher has
  no hub concept, and the dead zone actively fights relaying (stock held between the brake and the
  donation line cannot be re-shipped). On player exposure, the leaning both sides agreed on:
  **sensible defaults for the threshold family, never raw player-tweakable valves** — per-good
  warehouse micromanagement would be unmanageable and the numbers are illegible; if a valve ever
  earns player agency it should be one coarse in-fiction policy (a faction stockpile stance), with
  real player control living where the architecture already puts it (automation toggles, budgets,
  directed orders). Also noted: the dead zone's "player must invest" pressure is invisible in the
  UI — a world silently neither producing nor shipping — so even if dwell-time measurement shows
  the lock binding as intended, there is a legibility question about whether an unseeable band is
  the right *kind* of pressure. Hub-as-a-role (deliberate buffer + propagated demand + per-route
  capacity) reads as logistics-depth-pass material, not a threshold tweak. All stated as leanings;
  the dead zone's own fate still waits on the dwell-time evidence above.

## Evidence: dead-zone dwell time (claim committed before the instrument ran)

**Status: measured 2026-08-03.** The claim and falsifier below were committed before the
instrument ran (`f63aed6e`); the reading follows them.

```
Meaning:  The dead zone is overwhelmingly a brief handoff — markets drain through it at their
          full nominal demand rate in a few evaluations — but a small, persistent camping tail
          is real at equilibrium: industrial-input goods whose paper demand is not actually
          being drawn sit locked for hundreds of ticks, and about a dozen markets galaxy-wide
          are mid-camp at any given equilibrium moment.
Claim:    as committed below (lock = camps material by visit share, occupancy share, or
          ongoing-camp count).
Number:   equilibrium (t 9600–12000): median completed dwell 4 evaluations, p90 4, max 30;
          camp share 2.5% of completed visits; camps hold 11.0% of in-zone market-cycles;
          12 distinct markets end the run mid-camp; in-zone occupancy 0.71% of checks.
          Startup (≤ t 1008): 273 visits, all completed, median 1, max 6, zero camps.
          Camps drain at median 0.27× nominal demand; pass-throughs at 1.00×.
Horizon:  both. Startup and equilibrium of one 12,000-tick run, with a stationarity check
          (t 7200–9600 vs 9600–12000): the dwell DISTRIBUTION is stationary (median 3→4,
          camp share 2.9%→2.5%, camp occupancy 10.2%→11.0%); zone OCCUPANCY is not
          (0.53%→0.71% of checks, still rising at run end).
Cohort:   all developed-system markets (15,132 by run end), sampled at the matcher's own read
          point, 600 systems, seed 42, ECONOMY_SCALE=100, single seed. Floored cohort
          (real demand < MIN_DEMAND): 13 of 10,419 visits, zero camps — the zone essentially
          does not exist below the floor, matching the geometry (donation line drops below the
          brake ceiling under ~0.93 × MIN_DEMAND). Campers concentrate in industrial-input
          goods: metals, minerals, ore, gas, biomass, chemicals, polymers.
Licenses: Supports: the zone's typical behaviour is pass-through at full nominal drain
          (median 3–4 evaluations ≈ its ≤4-cycle geometric width); a real camping tail exists
          at equilibrium and not at startup; camps are precisely the markets draining at a
          small measured fraction of nominal demand — the lock binds where demandRate
          overstates actual draw; the lock is absent for floored markets.
          Does NOT support: why actual draw is absent on camping markets (downstream
          input-gating/strikes is plausible but unmeasured); which route lifts a market over
          the donation line (still unmeasured, below); the equilibrium LEVEL of zone occupancy
          (still rising at t=12,000); generalisation beyond seed 42. Threshold (c) passed at
          12 vs 10 — a thin margin on one seed; "material lock" is established via the
          ongoing-camp channel only, not via visit share (2.5% vs the 10% bar) or occupancy
          (11.0% vs the 25% bar).
```

**Outcome: not falsified — confirmed narrowly, via threshold (c) alone.** The answer to
"moments or camping": moments for ~97% of visits; a real, identifiable camping cohort holds
~11% of in-zone time. The lock exists, is small, is growing with galaxy maturation, and is
specifically the cohort whose nominal demand is not being drawn — a denominator honesty
problem, not the zone's typical behaviour.

<details><summary>Raw output (12,000-tick run)</summary>

```
scale=100 systems=600 seed=42 ticks=12000 cycle=24 logisticsInterval=24
zone: brake=HOLD_COVER(1.3)×targetStock(TARGET_COVER=40, MIN_DEMAND=5) → donate=SURPLUS_MARGIN(1.4)×DONOR_RESERVE_COVER(40)×demand; camp ≥ 8 evaluations
  …t=1000 (rows so far: 272)
  …t=2000 (rows so far: 2344)
  …t=3000 (rows so far: 3974)
  …t=4000 (rows so far: 5378)
  …t=5000 (rows so far: 6685)
  …t=6000 (rows so far: 8028)
  …t=7000 (rows so far: 9820)
  …t=8000 (rows so far: 12466)
  …t=9000 (rows so far: 15929)
  …t=10000 (rows so far: 19733)
  …t=11000 (rows so far: 23818)
  …t=12000 (rows so far: 28883)

VALIDATION:
  sampled boundary ticks: 500 (first 24, last 12000)
  t=24: hook eligible=520  independent developed-market count=520  MATCH
  t=6024: hook eligible=15132  independent developed-market count=15132  MATCH
  t=12000: hook eligible=15132  independent developed-market count=15132  MATCH
  totals: eligible=6921460  braked=160732 (2.32%)  in-zone rows=28883 (0.42% of checks)
  (prior session, same seed/systems: ~1% of ordinary-path checks sat in the gap — order-of-magnitude cross-check)

STARTUP (visits starting ≤ t=1008)
  visits started here: 273 (completed 273, censored 0)
  completed dwell (evaluations): median 1.0  p90 3  max 6
  camp share of completed (≥8): 0/273 (0.0%)
  occupancy: in-zone samples 329 (0.28% of checks)  camp-owned 0 (0.0% of in-zone)
  cohort floored (demand<MIN_DEMAND): n=4 medianDwell 1.5 campShare 0.0%
  cohort unfloored:                  n=269 medianDwell 1.0 campShare 0.0%
  drain/demand ratio: camps median 0.00 (n=0)  pass-throughs median 0.99 (n=62)

STATIONARITY CHECK (t=7200–9600)
  visits started here: 2488 (completed 2488, censored 0)
  completed dwell (evaluations): median 3.0  p90 4  max 34
  camp share of completed (≥8): 71/2488 (2.9%)
  occupancy: in-zone samples 7952 (0.53% of checks)  camp-owned 809 (10.2% of in-zone)
  cohort floored (demand<MIN_DEMAND): n=0
  cohort unfloored:                  n=2488 medianDwell 3.0 campShare 2.9%
  drain/demand ratio: camps median 0.26 (n=71)  pass-throughs median 1.00 (n=1852)

EQUILIBRIUM (t=9600–12000)
  visits started here: 3153 (completed 3011, censored 142)
  completed dwell (evaluations): median 4.0  p90 4  max 30
  camp share of completed (≥8): 76/3011 (2.5%)
  censored mid-camp (≥8): 12
  occupancy: in-zone samples 10686 (0.71% of checks)  camp-owned 1176 (11.0% of in-zone)
  cohort floored (demand<MIN_DEMAND): n=2 medianDwell 1.0 campShare 0.0%
  cohort unfloored:                  n=3151 medianDwell 4.0 campShare 2.8%
  drain/demand ratio: camps median 0.28 (n=88)  pass-throughs median 1.00 (n=2356)

WHOLE RUN
  visits started here: 10419 (completed 10277, censored 142)
  completed dwell (evaluations): median 3.0  p90 4  max 34
  camp share of completed (≥8): 175/10277 (1.7%)
  occupancy: in-zone samples 28883 (0.42% of checks)  camp-owned 2290 (7.9% of in-zone)
  cohort floored (demand<MIN_DEMAND): n=13 medianDwell 1.0 campShare 0.0%
  cohort unfloored:                  n=10406 medianDwell 3.0 campShare 1.8%
  drain/demand ratio: camps median 0.27 (n=187)  pass-throughs median 1.00 (n=6873)

CLAIM THRESHOLDS (equilibrium window):
  (a) camp share of completed visits ≥ 10%: 2.5% → NOT MET
  (b) camp occupancy ≥ 25% of in-zone market-cycles: 11.0% → NOT MET
  (c) markets ending the run mid-camp ≥ 10: 12 → MET

PER-GOOD CAMPERS (whole run, camp market-cycles):
  metals           campCycles=511  visits(all)=477
  minerals         campCycles=391  visits(all)=497
  ore              campCycles=348  visits(all)=799
  gas              campCycles=331  visits(all)=760
  biomass          campCycles=161  visits(all)=259
  chemicals        campCycles=157  visits(all)=282
  polymers         campCycles=139  visits(all)=234
  munitions        campCycles=90  visits(all)=851
  alloys           campCycles=61  visits(all)=223
  textiles         campCycles=57  visits(all)=221
  components       campCycles=27  visits(all)=326
  hull_plating     campCycles=9  visits(all)=277

LONGEST VISITS:
  system-76 ore            len=34 t=7584–8376 floored=false meanDemand=456.887 drainRatio=0.10
  system-152 metals         len=33 t=9600–10368 floored=false meanDemand=281.833 drainRatio=0.05
  system-580 textiles       len=30 t=11016–11712 floored=false meanDemand=230.819 drainRatio=0.14
  system-282 metals         len=27 t=11304–11928 floored=false meanDemand=120.609 drainRatio=0.14
  system-381 polymers       len=27 t=8856–9480 floored=false meanDemand=166.586 drainRatio=0.06
  system-427 minerals       len=27 t=10176–10800 floored=false meanDemand=299.519 drainRatio=0.15
  system-593 chemicals      len=25 t=3768–4344 floored=false meanDemand=121.707 drainRatio=0.05
  system-470 metals         len=25 t=6984–7560 floored=false meanDemand=182.536 drainRatio=0.14
  system-336 metals         len=25 (censored) t=11424–12000 floored=false meanDemand=329.659 drainRatio=0.12
  system-582 minerals       len=24 t=3264–3816 floored=false meanDemand=240.963 drainRatio=0.10
```

</details>

**Definitions.** A market is *in the dead zone* at a logistics evaluation when both are true at the
matcher's own read point: `stock ≥ HOLD_COVER × targetStock` (the brake ceiling — production fully
halted, `marketBandForRow`'s anchor) and `surplusDrawable(...) === 0` (donation refused). One sample
per market per logistics evaluation (`LOGISTICS_INTERVAL` = `CYCLE_LENGTH` = 24, so evaluations ≡
cycles). A *visit* is a maximal run of consecutive in-zone evaluations for one (system, good). A
*camp* is a visit of ≥ 8 consecutive evaluations — twice the ≤ 4-cycle full-rate drain-through
width of the zone, so a camp means the market drains at well under half its nominal demand rate
rather than merely passing through. Visits still in-zone at run end are *censored* and counted
separately (a permanent lock shows up there, not in completed visits).

**Claim.** The [1.3, 1.4)× dead zone is a real lock: at equilibrium, a material share of the
markets that enter it camp there rather than passing through — (a) camps are ≥ 10% of completed
visits, or (b) camps (completed + censored) hold ≥ 25% of total in-zone market-cycles, or (c) ≥ 10
distinct markets end the run mid-camp.

**Falsifier.** If at BOTH horizons (startup: visits starting in cycles 0–42; equilibrium: the last
100 cycles of a 12,000-tick run, checked stationary against the 100 cycles before it) all three
fail — camp share < 10% of completed visits, camp occupancy < 25% of in-zone market-cycles, and
< 10 markets censored mid-camp — the claim is false: the zone is a transient handoff. The
"silent locked world" legibility worry and any lock-relief argument in open question 1 lose their
factual premise, and the brake-denominator question is argued on pricing-coupling grounds alone.

**Instrument.** Hook inside the directed-logistics processor at state assembly (the matcher's read
point, inside the tick), computing the brake line with `marketBandForRow` and the donation side with
`surplusDrawable` — the engine's own functions. Scratch runner `.superpowers/dwell-diag.ts` drives
`runWorldTick` for 12,000 ticks (600 systems, seed 42), reconstructs visits, cohorts floored
(real demand < `MIN_DEMAND`) vs unfloored markets and reports per-good campers. Validation before
reading: collector's per-evaluation eligible-market count must equal an independent count of
developed-system market rows, and in-zone occupancy must land near the prior measurement's ~1% of
ordinary-path checks (same seed and conditions). The lib/ hook is a measuring patch, reverted
before write-up.

## Direction agreed (Kai, 2026-08-03) — pending measurements, then spec

Agreed in discussion after the dwell evidence landed. Not yet a spec; the spec follows the two
measurements below and gets a `/spec-review` (heavy cross-mechanic surface: economy processor,
logistics, planner all read the demand figure).

1. **Demand honesty first — the lead work item.** Industrial input demand is today counted at
   factory *capacity*; it must be counted at what factories would actually draw (gated by staffing,
   strike, and their own output brake — "what would this factory pull if this input were abundant").
   Civilian want always counts at full rate — a starving world must never read as low-demand (the
   rationing death-spiral trap). This is the fix for the measured camping cohort, and it touches
   every reader of the demand figure at once: deficit targets, donor reserves, matcher severity,
   planner sizing.
2. **The brake leaves the price anchor, onto honest flow.** Stockpile fullness is measured against
   the larger of "cycles of what I actually use" (consumers) and "cycles of what I make" (producers'
   working inventory: while shipments collect output the yard stays low and production runs; when
   nothing draws, the yard fills and the world idles). No price reference, no `MIN_DEMAND` floor —
   the output denominator answers open question 2's pure-exporter trap directly.
3. **Price re-enters only in the later pricing pass** (the unqueued goods-pricing revisit) — as a
   signal layered on this machinery, which must function without it. Kai: the current pricing
   mechanism is wrong and needs its own pass; nothing here should lean on it.
4. **The dead-band stays** (question 3): chosen conservatism stands — the dwell evidence shows the
   band is mostly a harmless handoff whose only pathology was the dishonest demand figure. At spec
   time both lines get restated in one unit family and the `band-constants.test.ts` invariant (today
   comparing anchor-units to demand-units) is rewritten in those units.

Dispositions of the four open questions: Q1 answered (off the anchor, onto honest use/output,
demand honesty first), Q2 dissolved by the output denominator, Q3 stays as chosen conservatism
restated in new units, Q4 explicitly deferred to the pricing pass.

**Next steps, in order:**
- ~~`/measure` who the brake currently bites~~ — done 2026-08-03, claim falsified (below): the
  brake is a live exporter governor; the brake change carries its own behavioural A/B.
- ~~`/measure` the size of the demand fiction~~ — done 2026-08-04, claim confirmed via the share
  bar (below): concentrated fiction, 1-in-7 checks at ≤ half-draw, aggregate nearly honest.
  The behavioural A/B (honest vs nominal) still runs at implementation time.
- ~~`/measure` throttled exporters: unmet vs sated~~ — done 2026-08-04, claim falsified (below):
  71.8% face reachable deficits; the standing constraint is haul budget / matching, not
  production volume.
- ~~`/measure` (new, from the B falsification): why do reachable deficits persist beside drawable
  stock — budget exhaustion vs route cost vs matching order?~~ — done 2026-08-04, claim FALSIFIED
  (below): the haul budget owns 0% — it never binds (zero funding-bound events, 6–8% spent) and an
  infinite budget reproduces the identical transfers. Persisting deficits are thin reachable
  drawable stock (~57% at equilibrium, the brake A/B's channel) + the single-donor-per-cycle
  matcher structure (~42%, logistics-depth-pass material). Row 10's budget monetisation has no
  flow leverage unless authored to bind.
- Then the spec (demand honesty + brake denominators), then `/spec-review`.

## Evidence: who does the brake bite (claim committed before the instrument ran)

**Status: measured 2026-08-03 — claim FALSIFIED.** The falsifier (`df4640ae`) predates the run.
The falsified claim was this session's own in-discussion arithmetic ("the brake mostly doesn't
bind exporters while logistics drains them") — wrong, and caught for the price of one measurement.

```
Meaning:  The brake is a live governor on exporters today, not a self-supplier-only mechanism —
          at equilibrium a third of all throttled market-checks are exporter-path, and nearly a
          fifth of exporter checks are throttled, almost always partially (the ramp) rather than
          fully halted. The brake redesign is therefore a material change to live export
          behaviour, not a tidy-up.
Claim:    exporter-path markets account for under 10% of throttled checks at equilibrium.
Number:   equilibrium exporter share of throttled = 31.9% (94,063 ramp + 4,768 closed of
          309,785). Exporter share of fully-closed alone: 8.1% — 95% of exporter throttling is
          the ramp, the partial regime. Throttle rate within each path: exporters 18.3%,
          ordinary 21.7%. Startup: exporter share of throttled 58.7% (seeded stocks).
Horizon:  both, one 12,000-tick run. Stationarity: exporter share of throttled 37.0% → 31.9%
          across the two late windows (falling, far above 10% in both); total throttled share of
          checks 13.4% → 20.5% — still RISING at t=12,000, so the throttle-occupancy level is
          not settled, only the cohort composition reading.
Cohort:   all developed-system markets, same conditions as the dwell run (600 systems, seed 42,
          scale 100, single seed). Per-good: exporter ramp dominated by food and water
          (agricultural exporters); fully-closed dominated by ordinary-path food/ore/munitions.
Licenses: Supports: the brake change needs its own behavioural A/B (the falsifier's stated
          consequence — now in force); the operative throttle regime is the ramp, so the redesign
          is about where the *governor* sits, not about un-halting stopped worlds; an exporter's
          governor is today denominated in its floored LOCAL demand, unrelated to its role.
          Does NOT support: that this throttling is wrong (a sated exporter idling may be the
          mechanism working as intended — whether each throttled exporter faces unmet reachable
          demand was not measured); the equilibrium level of throttle occupancy (still rising);
          generalisation beyond seed 42.
```

**Consequence, per the pre-committed falsifier:** the brake-denominator change is a live
behaviour change for exporters and carries its own behavioural A/B at implementation — it does
not ride the demand-honesty change. The direction itself stands (it never rested on this claim);
the risk ordering is updated: demand honesty is the safer half, the brake change the riskier.
One follow-up measurement now matters for the spec: of the throttled exporters, how many face
unmet reachable demand (governor wrongly engaged) vs none (sated, working as intended)?

<details><summary>Raw output (12,000-tick run)</summary>

```
scale=100 systems=600 seed=42 ticks=12000 cycle=24 logisticsInterval=24
band: free ≤ target(TARGET_COVER=40) < ramp < closed ≥ HOLD_COVER(1.3)×target; exporter = production > demand && !suppressed

VALIDATION:
  sampled boundary ticks: 500 (first 24, last 12000)
  t=24: hook eligible=520  independent developed-market count=520  MATCH
  t=6024: hook eligible=15132  independent developed-market count=15132  MATCH
  t=12000: hook eligible=15132  independent developed-market count=15132  MATCH
  closed-check whole-run total: 160732  expected (dwell run, deterministic): 160732  MATCH

STARTUP (≤ t=1008)
  checks: 116324  (exporter-path 22711 = 19.5%, ordinary 93613)
  throttled (ramp+closed): 6413 = 5.5% of checks
    ramp   4820 (exporter 3164, ordinary 1656)
    closed 1593 (exporter 603, ordinary 990)
  exporter share of throttled: 3767/6413 = 58.7%
  exporter share of closed:    603/1593 = 37.9%
  throttle rate within each path: exporters 16.6%  ordinary 2.8%

STATIONARITY CHECK (t=7200–9600)
  checks: 1513200  (exporter-path 558042 = 36.9%, ordinary 955158)
  throttled (ramp+closed): 202014 = 13.4% of checks
    ramp   158041 (exporter 69923, ordinary 88118)
    closed 43973 (exporter 4885, ordinary 39088)
  exporter share of throttled: 74808/202014 = 37.0%
  exporter share of closed:    4885/43973 = 11.1%
  throttle rate within each path: exporters 13.4%  ordinary 13.3%

EQUILIBRIUM (t=9600–12000)
  checks: 1513200  (exporter-path 539827 = 35.7%, ordinary 973373)
  throttled (ramp+closed): 309785 = 20.5% of checks
    ramp   250634 (exporter 94063, ordinary 156571)
    closed 59151 (exporter 4768, ordinary 54383)
  exporter share of throttled: 98831/309785 = 31.9%
  exporter share of closed:    4768/59151 = 8.1%
  throttle rate within each path: exporters 18.3%  ordinary 21.7%

WHOLE RUN
  checks: 6921460  (exporter-path 2287814 = 33.1%, ordinary 4633646)
  throttled (ramp+closed): 747320 = 10.8% of checks
    ramp   586588 (exporter 270594, ordinary 315994)
    closed 160732 (exporter 25871, ordinary 134861)
  exporter share of throttled: 296465/747320 = 39.7%
  exporter share of closed:    25871/160732 = 16.1%
  throttle rate within each path: exporters 13.0%  ordinary 9.7%

CLAIM (equilibrium): exporter-path < 10% of throttled checks: 31.9% → FALSIFIED

CLOSED BY GOOD (whole run, top 12 by total):
  food             total=  23533  exporter=   2876  ordinary=  20657
  ore              total=  15573  exporter=   5675  ordinary=   9898
  munitions        total=  14000  exporter=   2745  ordinary=  11255
  gas              total=  11990  exporter=   2887  ordinary=   9103
  minerals         total=  11050  exporter=   2745  ordinary=   8305
  metals           total=   8353  exporter=   1700  ordinary=   6653
  water            total=   8218  exporter=    876  ordinary=   7342
  fuel             total=   7618  exporter=   1870  ordinary=   5748
  components       total=   6220  exporter=    707  ordinary=   5513
  machinery        total=   6061  exporter=    165  ordinary=   5896
  chemicals        total=   5689  exporter=   1300  ordinary=   4389
  radioactives     total=   5010  exporter=    576  ordinary=   4434

RAMP BY GOOD (whole run, top 12 by total):
  food             total= 105561  exporter=  62656  ordinary=  42905
  water            total=  70878  exporter=  42597  ordinary=  28281
  munitions        total=  43183  exporter=  20797  ordinary=  22386
  gas              total=  36539  exporter=  12856  ordinary=  23683
  minerals         total=  31978  exporter=   8851  ordinary=  23127
  metals           total=  28564  exporter=   5147  ordinary=  23417
  radioactives     total=  26671  exporter=  14321  ordinary=  12350
  ore              total=  24864  exporter=   7588  ordinary=  17276
  chemicals        total=  19869  exporter=   6861  ordinary=  13008
  components       total=  19584  exporter=   6763  ordinary=  12821
  hull_plating     total=  18872  exporter=   8560  ordinary=  10312
  machinery        total=  18300  exporter=   8307  ordinary=   9993
```

</details>

**Definitions.** At each logistics evaluation (the same read point as the dwell instrument), every
developed-system market is classified by brake state against the anchor band — *free*
(stock ≤ targetStock), *ramp* (targetStock < stock < HOLD_COVER × targetStock, production
partially throttled), *closed* (stock ≥ HOLD_COVER × targetStock) — and by path, using the
matcher's own exporter test: *exporter-path* (production > demand and not suppressed) vs
*ordinary-path*. "Throttled" = ramp or closed.

**Claim.** The brake's throttle rests almost entirely on ordinary-path markets: at equilibrium,
exporter-path markets account for under 10% of throttled checks.

**Falsifier.** If exporter-path markets are ≥ 10% of throttled checks at equilibrium, the claim is
false — the brake is actively throttling export capacity today, the redesign changes live export
behaviour materially, and the brake change needs its own behavioural A/B rather than riding the
demand-honesty one.

**Instrument.** Same hook site and conditions as the dwell run (12,000 ticks, 600 systems, seed 42),
aggregate counters only. Validation: the run is deterministic under the seed, so the closed-check
total must reproduce the dwell run's braked total (160,732) exactly, and the eligible count must
again equal the independent developed-market count.

## Evidence: size of the demand fiction (claim committed before the instrument ran)

**Status: measured 2026-08-04 — claim CONFIRMED, via the share bar only.** Falsifier committed as
`05ed9768` before the run.

```
Meaning:  The demand fiction is real but CONCENTRATED, not uniform: for three-quarters of
          industrial-demand market-checks the stated figure is close to what factories actually
          draw, but one check in seven overstates by 2× or more — most of those by 4×+ — and that
          cohort is stationary at equilibrium. The aggregate overstatement is modest (×1.18), so
          the fiction misprices individual markets' thresholds without much biasing galaxy totals.
Claim:    ≥ 10% of industrial-demand checks at ratio ≤ 0.5, OR galaxy overstatement ≥ 1.25×.
Number:   equilibrium: ratio ≤ 0.5 share 14.8% (9.0% of checks under 0.25); overstatement ×1.18
          (bar was 1.25 — this half FAILED); buckets 9.0 / 5.8 / 9.9 / 52.9 / 22.5%.
          Startup: 5.1% and ×1.06 — the fiction GROWS with galaxy maturation.
Horizon:  both, one 12,000-tick run; stationarity clean (share 14.8% in both late windows,
          overstatement ×1.15 → ×1.18).
Cohort:   industrial-demand checks = 42.5% of all developed-market checks (643,474 of 1,513,200
          at equilibrium), same conditions as the prior runs (600 systems, seed 42, scale 100).
          Per-good whole-run overstatement clusters at ×1.10–1.19 — the extreme cohort is spread
          across goods, not concentrated in one.
Licenses: Supports: demand honesty keeps its lead-item status via the share bar — the harm is
          per-market threshold mispricing in a material, stationary cohort (the campers were its
          extreme tail). Notably the aggregate bar alone would NOT have justified the work.
          Also measured: realized-based EXCEEDS nominal in 22.5% of checks (realized output can
          run above base capacity under event multipliers / population shifts) — the honest
          figure must handle both directions, not just deflation.
          Does NOT support: expecting large aggregate-flow changes from the fix (totals are
          nearly honest); reading realized-based as the true honest figure (it understates want
          exactly where the measured input itself is the binding constraint — honest sits
          between the two bounds).
```

<details><summary>Raw output — see the combined run below (shared with the sated-exporter measurement)</summary>

See the raw block under "are throttled exporters sated?".

</details>

**Definitions.** At each logistics evaluation, for every developed-system market whose demand
includes an industrial component: *nominal* industrial input demand is what the state carries today
(`demand − civilianDemand`, capacity-based); *realized-based* input demand is the same engine
function (`inputDemandFromProduction`) fed the system's realized production rates instead of
capacity. The ratio realized/nominal bounds the fiction: the true "honest" figure (what factories
would draw if the input were abundant) sits between the two, because realized output is itself
gated by the very input under measurement.

**Claim.** The fiction is broad, not confined to the camping cohort: at equilibrium, ≥ 10% of
industrial-demand market-checks show realized-based draw at or below half of nominal
(ratio ≤ 0.5), and galaxy-wide nominal industrial input demand exceeds realized-based by ≥ 1.25×.

**Falsifier.** If at equilibrium under 10% of industrial-demand checks sit at ratio ≤ 0.5 AND the
galaxy-wide nominal/realized-based ratio is under 1.25×, the fiction is narrow: demand honesty
remains the right fix for the measured campers but loses its "touches every reader" urgency, and
the spec re-scopes it accordingly.

## Evidence: are throttled exporters sated? (claim committed before the instrument ran)

**Status: measured 2026-08-04 — claim FALSIFIED.** Falsifier committed as `05ed9768` before the run.

```
Meaning:  Throttled exporters are NOT sated — over 70% of throttled exporter-path checks face a
          live reachable same-faction deficit in the very good they are throttled on. But the
          same reading shows those deficits persisting while drawable stock stands at the
          exporter, so the STANDING constraint on the deficits is the haul budget / route cost /
          matching order — not production volume. The brake engages while need exists, which
          kills the benign "idle saturated farm" reading; its causal share in the undersupply is
          unmeasured.
Claim:    under 25% of throttled exporter-path checks face a reachable same-faction deficit.
Number:   equilibrium: 71.8% (71,002 of 98,831). Whole run 70.4%; startup 52.9%. Per-good
          (whole run): ore 93.3%, gas 90.0%, radioactives 88.7%, minerals 86.9%, chemicals
          84.7%; the closest to genuinely sated are food 46.3% and water 56.5%.
Horizon:  both; stationary across the late windows (73.5% → 71.8%).
Cohort:   exporter-path checks above the anchor, matcher's own membership and reachability, same
          run/conditions as measurement A (600 systems, seed 42, scale 100, single seed).
Licenses: Supports: the "sated exporter idling" model is the minority case even for farms; the
          governor engages while faction need exists, so exporter throttling cannot be read as
          the mechanism working benignly.
          Does NOT support: the brake as the BINDING cause of those deficits. 100% of
          throttled-unmet exporters held drawable stock at the same evaluation — structurally
          guaranteed (throttled ⇒ stock > anchor ≥ exporter reserve), so this is not a finding
          in itself, but it means deliveries were available and something else (budget
          exhaustion, route cost, matching order) left the deficits standing. More production
          does not serve a budget-bound deficit; whether opening the brake changes outcomes is
          exactly what the booked behavioural A/B must answer.
```

**New question this opens (booked in next steps):** why do reachable deficits persist beside
drawable stock — budget exhaustion vs route cost vs matching order? This is the served-last /
leech-colony thread showing up in the exporter data, and it adjoins the "remove everything free"
audit (the haul work-budget is free, population-scaled v1) owned by roadmap row 10's territory.

<details><summary>Raw output (combined 12,000-tick run, measurements A + B)</summary>

```
scale=100 systems=600 seed=42 ticks=12000 cycle=24 logisticsInterval=24
(A) nominal = demand − civilianDemand (capacity-based); realized-based = inputDemandFromProduction(realized rates); ratio = realized/nominal
(B) throttled exporter = exporter-path ∧ stock > target(40); unmet = reachable same-faction deficit sink in the good (matcher membership)
    ramp/closed split at HOLD_COVER(1.3)×target

VALIDATION:
  sampled boundary ticks: 500 (first 24, last 12000)
  t=24: hook eligible=520  independent developed-market count=520  MATCH
  t=6024: hook eligible=15132  independent developed-market count=15132  MATCH
  t=12000: hook eligible=15132  independent developed-market count=15132  MATCH
  ramp whole-run total: 586588  expected 586588  MATCH
  closed whole-run total: 160732  expected 160732  MATCH

STARTUP (≤ t=1008)
  (A) industrial-demand checks: 12875 of 116324
      ratio buckets: [0,.25) 3.3%  [.25,.5) 1.9%  [.5,.75) 4.5%  [.75,1) 25.0%  ≥1 65.4%
      ratio ≤ 0.5 share: 660/12875 = 5.1%
      galaxy nominal 21224130 vs realized-based 19997875 → overstatement ×1.06
  (B) throttled exporter checks: 3767 (with drawable stock: 100.0%)
      facing reachable same-faction deficit: 1993/3767 = 52.9%

STATIONARITY CHECK (t=7200–9600)
  (A) industrial-demand checks: 638134 of 1513200
      ratio buckets: [0,.25) 8.9%  [.25,.5) 5.9%  [.5,.75) 8.1%  [.75,1) 45.8%  ≥1 31.2%
      ratio ≤ 0.5 share: 94454/638134 = 14.8%
      galaxy nominal 856943486 vs realized-based 746979930 → overstatement ×1.15
  (B) throttled exporter checks: 74808 (with drawable stock: 100.0%)
      facing reachable same-faction deficit: 55021/74808 = 73.5%

EQUILIBRIUM (t=9600–12000)
  (A) industrial-demand checks: 643474 of 1513200
      ratio buckets: [0,.25) 9.0%  [.25,.5) 5.8%  [.5,.75) 9.9%  [.75,1) 52.9%  ≥1 22.5%
      ratio ≤ 0.5 share: 94946/643474 = 14.8%
      galaxy nominal 893422795 vs realized-based 755450612 → overstatement ×1.18
  (B) throttled exporter checks: 98831 (with drawable stock: 100.0%)
      facing reachable same-faction deficit: 71002/98831 = 71.8%

WHOLE RUN
  (A) industrial-demand checks: 2506621 of 6921460
      ratio buckets: [0,.25) 9.2%  [.25,.5) 5.3%  [.5,.75) 8.0%  [.75,1) 38.8%  ≥1 38.6%
      ratio ≤ 0.5 share: 363415/2506621 = 14.5%
      galaxy nominal 2745355890 vs realized-based 2398011508 → overstatement ×1.14
  (B) throttled exporter checks: 296465 (with drawable stock: 100.0%)
      facing reachable same-faction deficit: 208665/296465 = 70.4%

CLAIM A (equilibrium): fiction is broad — ratio≤0.5 share ≥10%: 14.8%; overstatement ≥1.25×: ×1.18 → CLAIM HOLDS
CLAIM B (equilibrium): throttled exporters mostly sated — unmet share <25%: 71.8% → FALSIFIED

(A) PER-GOOD nominal vs realized-based (whole run, top 12 by nominal):
  gas              nominal= 426462164  realized= 358210035  ×1.19
  ore              nominal= 387493771  realized= 353429574  ×1.10
  minerals         nominal= 351602991  realized= 306145947  ×1.15
  metals           nominal= 278366246  realized= 245436229  ×1.13
  biomass          nominal= 243114330  realized= 207918336  ×1.17
  chemicals        nominal= 229442207  realized= 200953286  ×1.14
  polymers         nominal= 207368955  realized= 181546425  ×1.14
  textiles         nominal= 207368955  realized= 181546425  ×1.14
  components       nominal= 200941663  realized= 178836759  ×1.12
  electronics      nominal=  84975631  realized=  72864212  ×1.17
  consumer_goods   nominal=  64195990  realized=  55137016  ×1.16
  alloys           nominal=  31165119  realized=  27776632  ×1.12

(B) PER-GOOD throttled exporters (whole run, top 12 by throttled):
  food             throttled=  65532  unmet=  30332 (46.3%)
  water            throttled=  43473  unmet=  24557 (56.5%)
  munitions        throttled=  23542  unmet=  16804 (71.4%)
  gas              throttled=  15743  unmet=  14173 (90.0%)
  radioactives     throttled=  14897  unmet=  13219 (88.7%)
  ore              throttled=  13263  unmet=  12376 (93.3%)
  fuel             throttled=  12497  unmet=  10357 (82.9%)
  minerals         throttled=  11596  unmet=  10080 (86.9%)
  hull_plating     throttled=   8951  unmet=   6777 (75.7%)
  machinery        throttled=   8472  unmet=   6870 (81.1%)
  chemicals        throttled=   8161  unmet=   6913 (84.7%)
  polymers         throttled=   7734  unmet=   6207 (80.3%)
```

</details>

**Definitions.** A *throttled exporter* check is an exporter-path market (matcher's own test)
above its anchor (ramp or closed). It *faces reachable unmet demand* when, at the same
evaluation, some same-faction system within the matcher's own reachability (`reachableSystemIds`
+ non-null `routeCost`) classifies as a deficit sink in the same good (the matcher's own
membership: `classifyMarketState` deficit, shortfall > 0, production < demand).

**Claim.** Throttled exporters are mostly sated: at equilibrium, under 25% of throttled
exporter-path checks face any reachable same-faction deficit in the same good.

**Falsifier.** If ≥ 25% of throttled exporter-path checks face a reachable deficit at equilibrium,
the brake is suppressing production in the presence of reachable unmet demand at scale — the
governor is an active cause of undersupply, raising the brake redesign's urgency and implicating
it in the served-last pattern.

**Instrument (both measurements).** One combined run, same hook site and conditions as the two
prior runs (12,000 ticks, 600 systems, seed 42), aggregate counters only. Validation: eligible
must equal the independent developed-market count, and the ramp/closed totals must reproduce the
brake-cohort run's 586,588 / 160,732 exactly (deterministic seed).

## Evidence: deficit persistence attribution (claim committed before the instrument ran)

**Status: measured 2026-08-04 — claim FALSIFIED.** Falsifier committed as `c71c2589` before the
run.

```
Meaning:  The free haul budget owns NONE of the persisting deficit tonnage — it never binds
          (zero funding-bound events in 10,000 faction-evaluations; 6–8% of the budget spent)
          and an infinite-budget counterfactual reproduces the identical transfer set. Deficits
          persist because drawable stock within reach is thin (~57% of equilibrium unmet
          tonnage) and because the matcher grants each deficit one donor per cycle, leaving
          reachable stock unshipped (~42%); route reachability is a rounding error (~1%).
Claim:    as committed below (budget-owned = U_real − U_inf ≥ 50% of U_real at equilibrium).
Number:   equilibrium: budget-owned 0.0% — U_real = U_inf = 10,566,883,192 shortfall-units
          exactly; funding-bound 0 of 2,000 evaluations (0 of 10,000 whole run); budget spent
          6.0% (whole run 8.1%). U_inf decomposition: single-source 42.0%, thin-reachable-stock
          56.8%, unreachable 1.0%, drained-by-order 0.2%, no-donor 0.0%. Service by severity
          quartile (worst→least): 2.1 / 5.3 / 9.0 / 18.6%. Sink population quartiles: smallest
          quartile served 19.2% of its shortfall, largest 1.7% — ~75% of U_real sits in the
          largest-population quartile. Startup: budget-owned 0.0%; no-donor 86.4%
          (lone-homeworld factions), thin 12.2%.
Horizon:  both, one 12,000-tick run. The claim reading is stationary (budget-owned 0.0% and
          funding-bound 0 in every window); the structural mix is NOT stationary — single-source
          29.5% → 42.0% and thin 69.2% → 56.8% across the late windows, still shifting at
          t=12,000 as the maturing galaxy accumulates drawable stock.
Cohort:   every matcher deficit (2,820,188 deficit-checks over 10,000 faction-evaluations, all
          factions + independents), 600 systems, seed 42, scale 100, single seed. Tonnage is
          fill-to-logisticsTarget shortfall units (40-cycle warehouse cover), not per-cycle
          consumption.
Licenses: Supports: the served-last pattern is not a budget phenomenon — monetising the haul
          budget (row 10's audit) changes nothing at current effective pricing, since flows use
          6–8% of it (a priced budget binds only if authored below that); the brake A/B must not
          read persisting deficits as budget noise, and budget headroom EXISTS for brake-released
          stock to move; the one-donor-per-deficit-per-cycle structure is a real and growing
          constraint (42% of equilibrium unmet tonnage sat reachable-but-unshipped at the
          deficit's turn); in tonnage terms "served last" is the LARGEST worlds — their 40-cycle
          gaps dwarf any donor's drawable — while the smallest quartile gets the best fill
          fraction.
          Does NOT support: why reachable drawable stock is thin (brake suppression vs
          consumption vs donor reserves — the brake A/B's question, unanswered here); that a
          funding gate can never bind (funded fractions sat ≈1 in this run; row 10 could author
          one that does); reading U_real as starvation (it is a warehousing gap); generalisation
          beyond seed 42.
```

**Consequence, per the pre-committed falsifier:** the presumption that row 10's
remove-everything-free audit has leverage on the served-last pattern through the haul budget is
dead — the budget is ~94% idle and pricing it is treasury flavour, not a flow change, unless it
is deliberately authored to bind. The attribution redirects the question to the two live owners:
thin reachable drawable stock (the channel the brake redesign acts on — and since the budget
never binds, any stock the brake change releases has the haul headroom to actually move) and the
matcher's single-donor-per-deficit-per-cycle structure, which adjoins Kai's hub/chain leaning in
"Inputs noted" and reads as logistics-depth-pass material, not part of this spec. The
leech-colony framing also inverts in tonnage terms: small colonies get the best fill *fraction*;
the unmet-tonnage backlog concentrates at the largest worlds.

<details><summary>Raw output (12,000-tick run)</summary>

```
scale=100 systems=600 seed=42 ticks=12000 cycle=24 logisticsInterval=24
deficit = classifyMarketState deficit ∧ shortfall>0 ∧ production<demand (matcher membership); residual = shortfall − delivered at evaluation end
U_real = residual under the live budget; U_inf = residual under generation=1e15 (same states, same matcher); budget-owned = U_real − U_inf
CF structural buckets: single-source (reachable drawable remained at its turn) / drained-by-order (reachable initial ≥ shortfall) / thin (reachable initial < shortfall) / unreachable / no-donor
constants: DEFICIT_FRACTION=0.8 SURPLUS_MARGIN=1.4 GENERATION_PER_POP=50

VALIDATION:
  sampled boundary ticks: 500 (first 24, last 12000)
  t=24: hook eligible=520  independent developed-market count=520  MATCH
  t=6024: hook eligible=15132  independent developed-market count=15132  MATCH
  t=12000: hook eligible=15132  independent developed-market count=15132  MATCH
  ramp whole-run total: 586588  expected 586588  MATCH
  closed whole-run total: 160732  expected 160732  MATCH
  engine real-mode deficits: 2820188  call-site recount: 2820188  MATCH
  cf-mode deficits: 2820188  (must equal real: same states)  MATCH
  engine real-mode transfers: 1307758  processor match.transfers: 1307758  MATCH

STARTUP (≤ t=1008)
  deficits: 56339 over 840 faction-evaluations  shortfall 265616466
  real: served 5008270 (1.9% of shortfall)  U_real 260608196
        outcomes: fully 24642  partial 2239  unserved 29458  funding-bound 0 (residual 0)
        budget: total 244122749  spent 12538659 (5.1%)  first-bound at rank n/a (0/840 evals bound)
        served by severity quartile (worst→least): 1.6%  2.3%  3.4%  4.6%
  cf:   served 5008270 (1.9%)  U_inf 260608196  cf spend 12538659 (0.05× the real budget)
        U_inf ≤ U_real: OK
  BUDGET-OWNED: 0 = 0.0% of U_real
  U_inf decomposition: single-source 0.5%  drained-by-order 0.4%  thin 12.2%  unreachable 0.4%  no-donor 86.4%

STATIONARITY CHECK (t=7200–9600)
  deficits: 469369 over 2000 faction-evaluations  shortfall 14662284270
  real: served 312581578 (2.1% of shortfall)  U_real 14349702691
        outcomes: fully 33538  partial 258485  unserved 177346  funding-bound 0 (residual 0)
        budget: total 7692102616  spent 552415618 (7.2%)  first-bound at rank n/a (0/2000 evals bound)
        served by severity quartile (worst→least): 1.7%  3.8%  6.7%  11.0%
  cf:   served 312581578 (2.1%)  U_inf 14349702691  cf spend 552415618 (0.07× the real budget)
        U_inf ≤ U_real: OK
  BUDGET-OWNED: 0 = 0.0% of U_real
  U_inf decomposition: single-source 29.5%  drained-by-order 0.4%  thin 69.2%  unreachable 1.0%  no-donor 0.0%

EQUILIBRIUM (t=9600–12000)
  deficits: 340550 over 2000 faction-evaluations  shortfall 10857548232
  real: served 290665041 (2.7% of shortfall)  U_real 10566883192
        outcomes: fully 37611  partial 193938  unserved 109001  funding-bound 0 (residual 0)
        budget: total 7998196647  spent 476636019 (6.0%)  first-bound at rank n/a (0/2000 evals bound)
        served by severity quartile (worst→least): 2.1%  5.3%  9.0%  18.6%
  cf:   served 290665041 (2.7%)  U_inf 10566883192  cf spend 476636019 (0.06× the real budget)
        U_inf ≤ U_real: OK
  BUDGET-OWNED: 0 = 0.0% of U_real
  U_inf decomposition: single-source 42.0%  drained-by-order 0.2%  thin 56.8%  unreachable 1.0%  no-donor 0.0%

WHOLE RUN
  deficits: 2820188 over 10000 faction-evaluations  shortfall 49160971608
  real: served 1100829507 (2.2% of shortfall)  U_real 48060142101
        outcomes: fully 168632  partial 1139126  unserved 1512430  funding-bound 0 (residual 0)
        budget: total 25142369474  spent 2024801923 (8.1%)  first-bound at rank n/a (0/10000 evals bound)
        served by severity quartile (worst→least): 1.8%  3.8%  6.0%  7.5%
  cf:   served 1100829507 (2.2%)  U_inf 48060142101  cf spend 2024801923 (0.08× the real budget)
        U_inf ≤ U_real: OK
  BUDGET-OWNED: 0 = 0.0% of U_real
  U_inf decomposition: single-source 23.1%  drained-by-order 0.7%  thin 73.7%  unreachable 2.0%  no-donor 0.6%

CLAIM (equilibrium): budget-owned ≥ 50% of U_real: 0.0% → FALSIFIED

PER-GOOD (whole run, top 12 by real residual):
  gas              U_real=  5356872078  U_inf=  5356872078  owned=  0.0%  cf: ss 46.4% dr 0.8% th 52.3% un 0.3% nd 0.3%
  ore              U_real=  5172838770  U_inf=  5172838770  owned=  0.0%  cf: ss 21.9% dr 0.4% th 76.3% un 0.8% nd 0.6%
  consumer_goods   U_real=  4350788948  U_inf=  4350788948  owned=  0.0%  cf: ss 10.6% dr 0.7% th 84.5% un 3.8% nd 0.5%
  minerals         U_real=  3688334243  U_inf=  3688334243  owned=  0.0%  cf: ss 35.5% dr 0.5% th 62.0% un 1.6% nd 0.4%
  electronics      U_real=  3432814678  U_inf=  3432814678  owned=  0.0%  cf: ss 4.6% dr 0.6% th 90.6% un 3.4% nd 0.8%
  textiles         U_real=  3267564027  U_inf=  3267564027  owned=  0.0%  cf: ss 14.3% dr 0.6% th 82.1% un 2.5% nd 0.5%
  chemicals        U_real=  3222095726  U_inf=  3222095726  owned=  0.0%  cf: ss 24.7% dr 0.6% th 73.2% un 0.9% nd 0.6%
  polymers         U_real=  2911069393  U_inf=  2911069393  owned=  0.0%  cf: ss 20.6% dr 0.6% th 76.5% un 1.9% nd 0.4%
  metals           U_real=  2454777612  U_inf=  2454777612  owned=  0.0%  cf: ss 23.4% dr 0.6% th 74.4% un 0.9% nd 0.7%
  components       U_real=  2156825737  U_inf=  2156825737  owned=  0.0%  cf: ss 21.1% dr 0.6% th 74.8% un 2.5% nd 1.0%
  biomass          U_real=  2097179695  U_inf=  2097179695  owned=  0.0%  cf: ss 17.5% dr 1.0% th 78.3% un 2.7% nd 0.5%
  water            U_real=  2019537864  U_inf=  2019537864  owned=  0.0%  cf: ss 36.1% dr 0.3% th 62.5% un 0.8% nd 0.3%

SINKS BY POPULATION QUARTILE (equilibrium; end-of-run population):
  Q1 pop 20–223 (146 sinks): served 19.2%  U_real 47852571  U_inf 47852571  budget-owned 0.0%
  Q2 pop 224–2118 (146 sinks): served 8.5%  U_real 583423472  U_inf 583423472  budget-owned 0.0%
  Q3 pop 2118–3860 (146 sinks): served 4.1%  U_real 2056835225  U_inf 2056835225  budget-owned 0.0%
  Q4 pop 3900–21766 (144 sinks): served 1.7%  U_real 7878771923  U_inf 7878771923  budget-owned 0.0%
```

</details>

**Definitions.** At each logistics evaluation (the matcher's own loop, same read point and
conditions as the prior three runs), every deficit (matcher membership: `classifyMarketState`
deficit, shortfall > 0, production < demand) is served worst-severity-first from its single
nearest reachable drawable donor, within the faction's haul budget (Σ population-scaled
generation × funding). A deficit's *residual* is `shortfall − delivered` at the evaluation's end;
**U_real** is the summed residual tonnage. The *counterfactual match* re-runs the same states
through the same `matchFactionTransfers` with the budget made effectively infinite (per-system
generation 1e15); **U_inf** is its residual tonnage. **Budget-owned tonnage = U_real − U_inf** —
the shortfall that would have been served this same evaluation had the work budget not run out.
The counterfactual's own residual decomposes per deficit at its turn: *single-source* (other
reachable donors still held drawable stock — only the one-donor-per-evaluation structure left it
short), *drained-by-order* (reachable initial drawable ≥ shortfall, but more-severe deficits took
it first), *thin-reachable-stock* (reachable initial drawable < shortfall — never enough within
reach this cycle), *unreachable* (drawable exists in the faction, none of it within this sink's
route neighbourhood), *no-donor* (no drawable stock faction-wide in the good).

**Claim.** The haul budget owns the served-last pattern: at equilibrium, budget-owned tonnage
(U_real − U_inf) is at least 50% of U_real — the majority of the deficit shortfall left standing
at the end of a logistics evaluation would have been served in that same evaluation with an
unlimited work budget.

**Falsifier.** If budget-owned tonnage is under 50% of U_real at equilibrium (startup also read),
the claim is false: the standing constraint on persisting deficits is the matcher's structure
(single-donor turns, severity-order drainage) or genuine reachable-stock scarcity, not the free
haul budget — row 10's budget monetisation would not by itself materially change the served-last
pattern, and the brake behavioural A/B must not treat persisting deficits as budget noise.

**Instrument.** Measuring patch inside `matchFactionTransfers` itself
(`lib/engine/directed-logistics.ts`) — the matcher's own loop annotates each deficit's outcome —
plus a call-site hook in the processor that re-runs each faction's states with the inflated budget
under a collector mode flag. Scratch runner `.superpowers/deficit-attribution-diag.ts`, 12,000
ticks, 600 systems, seed 42, scale 100, aggregate counters only. Validation before reading:
eligible must equal the independent developed-market count; ramp/closed whole-run totals must
reproduce the brake-cohort run's 586,588 / 160,732 exactly (the patch must not perturb the
trajectory); the real-mode collector's transfer count must equal the processor's own
`match.transfers` total; U_inf ≤ U_real in every window (a violation is an instrument fault, not a
finding). Secondary colour, not claim-bound: budget utilisation and the required-budget multiple
(counterfactual spend ÷ real budget), severity-quartile service profile, per-good decomposition,
residuals cohorted by sink population. Both lib/ patches are measuring patches, reverted before
write-up.

All validations passed (see raw output). The funding-bound **zero** got its own second signal — a
counter that never fires and a mechanism that never fires look identical — via a forced-bind check
(`.superpowers/attrib-bind-check.ts`: budget 100 against a 1000-unit shortfall through the patched
matcher) which produced exactly one funding-bound event, quantity 100, funding residual 900: PASS.
The 0-of-10,000 reading is the mechanism, not the instrument.

## Related roadmap items

Item 4 (exporter price pinning) moved to the unqueued goods-pricing revisit on 2026-08-03 — pricing
rework waits for pop wages or inter-faction trade. Item 1 (the donor side) shipped as #212 — the
generosity rule now reads `DONOR_RESERVE_COVER`. Item 2 closed 2026-08-03 as chosen conservatism
(the [1.3, 1.4)× self-supplier lock is intended; see memory `killed-designs`) — **which makes this
session the sole owner of the brake-denominator question**. Item 5 (`TARGET_COVER` carrying three
roles) shipped: the founding fill target is `FOUNDING_STOCK_COVER` cycles of raw demand, the
harness surplus metric reads the donor line, and no logistics or planner code touches the anchor.
`productionCeiling`'s `HOLD_COVER × targetStock` is now the *only* physical mechanism measured
against the price anchor, and question 1 above reduces to it alone.
