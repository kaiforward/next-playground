# Economy Specialisation S4 — Guardrails & Joint S1–S4 Calibration

> **Status: working spec — discussion scaffold, not final.** Findings and hypotheses collected
> here for per-item discussion; more ideas will be added before this settles into a build plan.
> Stage S4 of the [economy-specialisation track](./economy-specialisation.md) (guardrails: volume
> + diffusion, plus the one joint calibration pass across everything S1–S3 shipped). The S2/S3
> lever lists recorded in the umbrella doc's findings sections feed in here.

## Headline

S1–S3 worked: the mature galaxy holds a durable price spread instead of flattening. The live 10k
dev DB at tick 8874 skews **expensive** (median 1.14× base, 55% of markets >1.1×, p10 0.81× →
p90 1.58×) — the overproduction-cheap signature is dead. S4's job is no longer "stop
over-building"; it is to (a) understand and shape the *expensive-skew equilibrium* the structural
stages produced, (b) fix the **fractional-smearing problem** (complexes and academies diffuse as
slivers instead of concentrating at hubs), (c) repair two per-good outliers (textiles, luxuries),
and (d) run the one joint S1–S4 calibration pass with all levers on the table.

## Evidence base

- **Live 10k dev DB audit @ tick 8874** (7,886 systems, `npm run audit:economy`, 2026-07-03).
  Health green: no NaN/runaway, 0 striking systems, unrest converged to its equilibrium target
  (0.060 actual vs 0.055 recomputed), pop utilisation 87.9%, 2.2% zero-pop systems (intended
  negative space), liquid flows (~157K flows / 200 ticks).
- **S2/S3 600-system sim A/Bs** (2026-07-02) — findings + levers recorded in
  [economy-specialisation.md](./economy-specialisation.md) §"S2 first-cut findings" and
  §"S3 first-cut findings". Not repeated here; the lever lists are consolidated below.

---

## Findings for discussion

### F1 — Complexes never mature at live scale (fractional smearing)

Not a single whole complex exists in the 10k galaxy at tick 8874. Heavy industry: 172 systems
holding slivers totalling 31.3 units (max 0.52). Chemicals: 236 systems, max 0.34. Electronics
and armaments: **zero**. Consumer: ~zero (5 systems, 0.7 total). Instead of "a decisive,
mostly-whole commitment" (`ANCHOR_FOOTPRINT = 8`, `ANCHOR_CAP = 1`), the planner smears
fractional complexes across hundreds of systems — a weak diffuse yield buff, not an anchor.
Strengthens S2 lever #2 beyond a buff/floor nudge: complexes likely need a **whole-unit build
quantum** (or drastically stronger seed/build sizing) or the mechanic isn't in play at all.

### F2 — Textiles is structurally broken, not just spread-y

Tier-0; galaxy nameplate is **0.59× consumption**, 71.5% of markets in deficit, 1.43× median
price, satisfaction 0.63 (lowest of any basket good). S3's demand boost outran deposit-gated
supply that physically can't follow (extraction capacity is slot/yield-capped; the build planner
can't conjure arable land). Either the textile basket weight is too heavy or its extraction
capacity too scarce. Distinct failure from every other good: this is aggregate volume, not
distribution.

### F3 — Luxuries is under-supplied in aggregate, not only spatially

0.80× nameplate/consumption, 85.5% of markets in deficit, 1.59× median price, satisfaction 0.67.
The S3 sim framed luxuries as the hub *import magnet* (spatial gradient — working as designed);
the live DB says total galaxy volume is also short. Decide how much of the 1.59× is wanted
gradient vs unwanted galawide shortfall before touching the basket weight.

### F4 — Academies are ubiquitous and fractional (same smearing disease as F1)

7,719 of 7,886 systems (98%) hold both academy types, averaging ~0.26 vocational-school units
each (2,022 total; research institutes 1,168 total, 9 systems ≥0.9 units). The S1 concentration
moat isn't visible in the building distribution — skill infrastructure is a galaxy-wide smear,
not a hub feature. May still be fine if skilled *work* concentrates (S3 sim found top-5% hubs do
the skilled work), but the sunk-cost moat can't bite when every system has already paid a
fractional academy. Likely the same root cause as F1: nothing in the planner prefers finishing a
unit here over starting a sliver there.

### F5 — Raws still glut (expected, but a calibration input)

Ore 2.72× consumption, 76.5% of ore markets cheap; tier-0 overall 1.92× with ~48% idle capacity.
This is the intended tier-0 negative space (deposits are where they are), but it sets the cheap
side of every trade gradient, so the joint pass should treat tier-0 oversupply magnitude as a
lever, not background.

### F6 — Oddity: economy-type classification near-extinct tails

Type distribution at 10k: extraction 5,778 / refinery 1,211 / agricultural 833 / core 57 /
**industrial 6 / tech 1**. Two classifications are nearly extinct at scale. Probably a seed
classification artifact rather than an S4 concern, but worth a glance — if `economyType` drives
anything downstream (UI filters, event targeting), the two dead categories are noise.

---

## Concerns & hypotheses (to investigate, not yet conclusions)

### H1 — Do market diffusion and directed logistics clash? (the 17.9% churn)

17.9% of all flow volume (Σmin(in,out) = 4.5M units / 200 ticks) is systems both importing and
exporting the same good. Concern: the two movers oppose by construction — **directed logistics**
pushes surplus→deficit toward stock targets, **market diffusion** pulls cheap→expensive down
price gradients — so logistics filling a deficit system lowers its price and can trigger market
diffusion exporting the same goods straight back out.

But decompose before tuning — the audit's own opposition metrics say the direct clash is small:

- True pairwise opposition (same good, same edge, both directions) is only 5,532 pairs,
  Σmin 531K units ≈ **2.1%** of volume — and its mix is overwhelmingly market×market (5,121)
  vs logistics+market (408) and logistics×logistics (3).
- The remaining ~16pp of "churn" is therefore mostly **through-traffic**: a waypoint on a
  multi-hop chain (A→B→C) necessarily counts as both importer and exporter of the good. That's
  legitimate entrepôt behaviour, arguably the *point* of a trade network.

**Investigation:** split the churn metric into (a) through-flow (net-flow direction consistent),
(b) same-edge round-trips, (c) logistics-in → market-out reversals (the suspected clash),
each as % of volume, before deciding any mechanism change. If (c) is real, candidate fixes are a
post-delivery price-settle delay, logistics respecting the market gradient direction, or a shared
hysteresis band — pick after measurement.

### H2 — "Expensive" is partly anchor geometry, not scarcity

The pop-satisfaction anchor and the price anchor are **the same stock level** (`targetStock =
TARGET_COVER × demandRate`): price = base exactly at target (`mid = base × (target/stock)^k`,
k=1), and the consume self-limiting factor (satisfaction) also reaches 1.0 exactly at target.
But satisfaction is √-shaped, so pops read *content* well below the anchor while price reads
*expensive* there. Worked example from the audit: mean satisfaction 0.850 ⇒ stock ≈ 0.72 of the
way up the [min, target] band ⇒ (with min ≈ 0.25×target) stock ≈ 0.79×target ⇒ price ≈ **1.27×**.
Unrest applies no pressure (dissatisfaction ≈ 0.055), the planner sees a served system, and the
galaxy happily equilibrates at stock levels that *price* as expensive. The observed median 1.14×
and 40–60% "deficit" markets for manufactured goods are consistent with a **pop-content
equilibrium sitting below the price anchor** — not with unmet need (tier-1/2 nameplate covers
consumption at ~1.1×).

Sub-question for calibration: is that *bad*? A mature galaxy that is calm but reads 1.1–1.3×
everywhere is arguably fine for trade gameplay (players arbitrage the dispersion, not the level).
If the level itself should read nearer 1.0×, the lever is the anchor geometry (satisfaction
saturating earlier than price, or `TARGET_COVER`), not production volume.

### H3 — Why the cheap→expensive flip was so violent

Two mechanisms, both structural:

1. **`HOLD_COVER = 1.3` bounds the cheap tail.** Producers idle as their local stock approaches
   1.3× the anchor, so a producer's own market can't fall much below base/1.3 ≈ **0.77×** — and
   the audit's global p10 is 0.81×. The old cheap signature was stock pinned at *storage clamps*
   by over-capacity; infrastructure decay now trims that capacity, so the clamp-pinned cheap mass
   is gone. The cheap tail is mechanically floored; the expensive tail runs free to the price
   ceiling. Any post-S1 galaxy therefore *must* skew expensive-side once over-capacity dies.
2. **S3 raised the anchor itself.** The skilled-basket demand lands in the stored per-market
   `demandRate`, and `targetStock = TARGET_COVER × demandRate` — so S3 didn't just add
   consumption, it *moved the price anchor up* at every developed system. Same physical stock,
   higher target, higher price reading. Part of the "expensive" shift is re-denomination, not
   scarcity.

Neither is a bug; both belong in the joint pass as understood geometry, so we tune the spread
around a deliberately-chosen price *level*.

---

## Consolidated lever list for the joint pass

From the S2/S3 findings (recorded in the umbrella doc) plus the above:

1. `ANCHOR_MIN_THROUGHPUT` — too high; electronics top throughput reached 9.75 vs floor 10 in the
   S3 sim. Lower it or make it per-family/relative. (S2 #1, quantified by S3.)
2. Complex build quantum / seed sizing / `buffMult` — make a complex a whole-unit commitment
   (F1); fractional smearing kills the anchor mechanic entirely at live scale.
3. Academy concentration — same quantum/scoring question as #2 (F4); fold academy overhead into
   opportunity scoring (the S1 "concentration moat" refinement, deferred to calibration).
4. Textiles: basket weight vs extraction capacity (F2) — aggregate volume repair.
5. Luxuries: wanted-gradient vs unwanted-shortfall split, then basket weight (F3, S3 #2).
6. Skilled-share realisation — realised ~20% technicians / ~6% engineers vs ~15%/4% intent
   (S3 #1); recheck per-head needs.
7. Diffusion friction — `DISTANCE_DECAY`, `FLOW_BUDGET`, `GRADIENT_THRESHOLD` (original S4 mode-3
   scope), tuned against the *real* S1–S3 gradient; plus whatever H1's decomposition surfaces.
8. Tier-scaled decay — original S4 mode-2 scope; note the volume problem inverted (galaxy is
   under-anchor, not over-built), so decay tuning is about *concentration*, not trimming glut.
9. Price-level choice — decide the intended mature median (H2/H3) before tuning anything priced
   off it.
10. Tier-0 oversupply magnitude (F5) — sets the cheap side of every gradient.

## Discussion agenda (pick up here next session)

Where the 2026-07-03 audit session left off. Order matters — the first item denominates the rest:

1. **Price-level choice first (H2/H3).** Is the calm-but-expensive mature galaxy (median
   1.1–1.3×, pops content, unrest converged) a problem or the design? Players arbitrage
   *dispersion*, not level — the level may be fine as-is. If we want the mature median nearer
   1.0×, the lever is anchor geometry (satisfaction saturating earlier than price, or
   `TARGET_COVER`), **not** production volume — tier-1/2 capacity already covers consumption.
   Every other lever (deficit %, "expensive" counts, basket weights) is read against this choice,
   so settle it before tuning anything priced off it.
2. **Fractional smearing (F1/F4).** Whole-unit build quantum for complexes — and decide whether
   it's a complex-only rule or a general planner concept that also fixes academy smear. This is
   the biggest structural gap: the S2 anchor mechanic is effectively not in play at live scale.
3. **Churn decomposition (H1) — measure before mechanism-tuning.** Extend `audit:economy` to
   split the 17.9% into through-flow / same-edge round-trips / logistics-in→market-out reversals.
   Current evidence says the logistics-vs-market clash is small (~2.1% true opposition, mostly
   market×market) and most churn is healthy entrepôt through-traffic — verify, then decide if any
   mechanism change is warranted at all.
4. **Per-good outliers (F2/F3).** Textiles = aggregate volume repair (deposit-gated supply can't
   follow S3 demand). Luxuries = first split wanted-gradient from unwanted-shortfall.
5. **F6 quick check** — whether anything downstream consumes `economyType` where the near-extinct
   industrial/tech categories distort.

More ideas to be added before this settles into a build plan.

## Open questions

- Is the pop-content-but-expensive equilibrium (H2) a problem or the design? What should the
  mature median price ratio *be*?
- Whole-unit build quantum: minimum-build-size for complexes only, or a general planner concept
  (academies too)? Interacts with the per-cycle build budget.
- H1 decomposition: how much of the 17.9% churn is entrepôt through-flow (healthy)?
- F6: does anything downstream consume `economyType` in a way the dead categories distort?
