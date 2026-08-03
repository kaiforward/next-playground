# How should pricing affect internal logistics?

**Status: an open design question, not a design.** Nothing here is decided. This file exists so a new
session can pick the discussion up without re-deriving it, and so the measured facts stay separated
from the reasoning built on top of them.

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
