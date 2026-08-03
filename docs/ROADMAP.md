# Roadmap

The single ordered queue of work. Memory tracks only *where we are* on it — nothing else keeps a
second copy of this list. When something ships, delete its row; git is the audit trail.

An item is: **what it is**, **next step** (one concrete action), and **Don't** (only when a
plausible-looking approach is already known-dead — the line that stops a dead path being re-walked).
Rationale, measurements and war stories belong in the linked design doc or in memory, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

---

## In progress

- **Process overhaul** — how we plan, design and implement. Two named failures: asserting on false
  premises far too early, and output Kai can't parse. Direction: drop superpowers for this project,
  write project-specific skills built around interconnected game systems (events is the recurring
  miss), make evidence the deliverable rather than a design.
  *Next step:* finish the instruction-mass cut (AGENTS.md done, docs + memory in flight), then design
  the replacement skills.

- **[L] Economy band reconciliation** — the `feat/band-reconciliation` shared branch. Design:
  [economy-band-reconciliation.md](./planned/economy-band-reconciliation.md). PR1-5 shipped plus #206-#211.
  Everything stays on this branch and it ships as one shared→main PR; that was settled deliberately,
  because the economy kept turning out to be wrong and the alternative was shipping interim-incoherent
  UI to main. shared→main needs only a light sanity pass — every sub-feature is reviewed going in.
  *Next step:* the economy queue below, then Provision, then PR6.

---

## Queued — economy

Ordered. These gate PR6: its presentation layer must sit on an economy that is settled, or the
numbers it presents are re-tuned underneath it. (Item 1, the `surplusDrawable` donor side, shipped
as #212 — rows keep their numbers when one ships, so references stay stable.)

4. **[S] An exporter's resting price is pinned at its ceiling, not graded** — a drawn exporter rests at
   `EXPORT_RESERVE_COVER` (10 cycles), below the price curve's saturation point, so the curve clamps.
   Measured at equilibrium: 3.00× / 3.00× / 2.50× for `electronics` / `luxuries` / `fuel`. Price stops
   being a health gauge on exactly the cohort that ships goods.
   *Next step:* a **decision, not a change** — is a flat exporter price acceptable (exporters run drained
   by design, importers carry the dispersion), or must it grade?
   *Don't:* lower the anchor (retracted — see item 5), and don't raise the reserve (that withholds real
   stock from importers). If it must grade, the lever is the curve's saturation point, which makes this a
   companion to per-good `MarketCurve.k`.

5. **[M] `TARGET_COVER` carries three roles in one constant** — authored as a *pricing* reference and the
   whole-roster knob for price dispersion, then borrowed as a fill target and as `productionCeiling`'s
   throttle knee. #211 already took the logistics deficit line off it (`WAREHOUSE_COVER` owns that now,
   held equal at 40 and asserted in `band-constants.test.ts`).
   *Next step:* re-denominate the remaining borrowers in cycles of demand — the shape `EXPORT_RESERVE_COVER`
   used in #207 and `WAREHOUSE_COVER` used in #211. Prerequisite for pop wealth. Carries three small
   deferrals from #212 and the row-2 closure: decide the fate of `surplusDrawable`'s `targetStock <= 0`
   guard (the function's last price-anchor read), re-denominate or retire the harness surplus-share
   metric (`market-analysis.ts:250`, still counts against price-anchor cover), and fix the docstrings
   that say "roadmap item 2 owns" the brake line — that ownership moved to the pricing-vs-logistics
   session when row 2 closed (see memory `killed-designs`, the [1.3,1.4) lock entry).
   *Don't:* lower the anchor. That was measured at 125 cycles, inside the ~300-cycle startup transient,
   and is retracted; run unmodified to 416 cycles and the galaxy reaches price median 1.23×, mean D 0.030
   on its own. The anchor is never reached by design and that is fine.

10. **[L] Colonisation economics — founding stops being free.** Now that monetary mechanics exist,
    colonisation becomes a major, resource-intensive undertaking (Stellaris-scale): claims,
    establish projects and founding manifests carry real monetary and goods cost, and the AI
    founding policy prices colonies against its treasury instead of founding essentially everything
    by ~t500. Absorbs the **remove-everything-free audit**: the logistics work budget ("free,
    population-scaled in v1"), the per-pop construction pool base, cheap claims — sweep for the
    rest. Aim: fewer, deliberate colonies — the structural fix for the leech-colony / served-last
    pattern (the #212 documented cost, noted in `economy-autonomic-agency.md`). Design inputs:
    [pricing-vs-logistics.md](./build-plans/pricing-vs-logistics.md) "Inputs noted". The parked
    "colony seed size vs housing unit" item parked *because* it changes founding pacing — it may
    un-park here, deliberately.
    Sits before Provision by explicit ordering decision (2026-08-03): Provision's struck-world
    resolution and band calibration would otherwise be tuned against a galaxy of cheap colonies
    this row then removes.
    *Next step:* `/measure` the founding-economics baseline (founding rate and timing, per-colony
    cost today, treasury headroom at founding scale) before any design; then spec + `/spec-review`
    (heavy cross-mechanic: treasury, build planner, colonisation-value, migration, events).
    *Don't:* precision-tune anything Provision will re-define (its own Don't), and don't design the
    cost model from intuition — the treasury balances and founding cadence are measurable first.

---

## Queued — supply response, then PR6

6. **[L] Provision + supply response** — [supply-response.md](./planned/supply-response.md). Renames the
   supply score to **Provision** (a weighted-mean satisfaction percentage) because today's fold squares
   each good's shortfall and collapsed its range ~5×. Absorbs two items previously booked separately:
   re-cutting the unrest band, and struck worlds that can neither grow out nor die.
   Key input, already measured: `foldSupplyState` returns `rationing` for *any* `d > 0` and `supplied`
   only at exactly 0, so homeworlds at mean D 0.000 read 40% Rationing. There is no threshold to re-cut
   because there is no threshold.
   *Next step:* `/spec-review docs/planned/supply-response.md` — **required** before any implementation
   plan (cross-mechanic: unrest fold, regime label, struck-world cohort).
   Three steps inside it, **in order, measuring between** — (1) Provision + band demotion + struck-world
   resolution, (2) change-driven unrest, (3) adaptive expectation. Steps 2 and 3 both change what the
   slopes are measured against.
   *Don't:* precision-tune any constant before this lands — it invalidates them twice over.

7. **[L] PR6 — band-reconciliation presentation layer.** The branch's finish line.
   *Next step:* after item 6.
   **PR6 owns the doc fold**, which is bigger than it looks — do it on the branch, before the final review:
   - Four **active** docs the arc made stale: `economy-autonomic-agency.md`, `colonisation.md`,
     `tick-engine.md`, and `economy.md` (its decay section still documents the continuous
     `count ← count − unrestRate · count` formula, stale since whole-level decay and severity ramping).
   - Two **planned** docs whose features have already shipped and which must be promoted into
     `docs/active/` and deleted: `necessity-weighted-unrest.md` (448 lines — `GOOD_NECESSITY` and
     `slopeShortage` are live, and its headline "every good … currently hits unrest with the same
     instrument" is now false) and `economy-rationing-amendment.md` (89 lines — `RATION_COVER` is live).
   - `economy-band-reconciliation.md` itself is deleted at the same point.

---

## Queued — player seat

8. **[M] Phase 3 Slice 4 — alert feed** (faction situation log). Design:
   [player-seat-roadmap.md](./planned/player-seat-roadmap.md). Slices 1-3 shipped; active specs
   [player-seat.md](./active/gameplay/player-seat.md) + [player-seat-purse.md](./active/gameplay/player-seat-purse.md).

9. **[M] WS2 P2 — flow visualisation** on the map. Keeps its approved HTML prototype. Design:
   [design-map-flow-overlays](../docs/planned/ui-ws2-map-modes.md), memory `project-ws2-map-modes`.

---

## Unqueued

No order. Pull from here when the queue empties, or fold one in when a PR is already in the file.

**Economy / simulation**
- **[M] Per-good price response (`MarketCurve.k`)** — make "water spikes under scarcity, luxuries don't"
  real by giving each good its own price-curve exponent, without touching demand. `DEFAULT_ELASTICITY`
  is 1 for every good and `priceFloor`/`priceCeiling` is a pure tier lookup with zero per-good variation.
- **[M] Government layer revisit** — `GOVERNMENT_TYPES` carries only event weights and a danger baseline
  since the flat `consumptionBoosts` term was deleted. Governments are economically inert until something
  replaces it as an economic axis.
- **[XL] Pop wealth and buying power** — pops hold wealth and must afford their basket, so demand becomes
  partly monetary. Provision survives as a ratio and stays distinct (a world can hold the wealth and still
  lack the goods). *Blocked:* `demandRate` is already double-purposed as pricing anchor and logistics
  deficit anchor — item 5 is a hard prerequisite, not a nice-to-have.
- **[L] Expanded pop tiers / social strata** — today's tiering is labour-grade only. Richer strata carry
  their own baskets. Composes with adaptive expectation (per-class expectation is how Victoria 3 derives
  its reference); nothing breaks if it never lands.

**Tick performance**
- **[M] `toTickSystems` is the whole mid-cycle tick outside events** — 2.5 ms/tick at 2,400 systems,
  19.0% of a mid-cycle tick. Gating can't touch it: ship-arrivals and events both run every tick and both
  consume `TickSystem` rows. *Next step:* check what those two actually read (ids/names; ids/names/control/region)
  before assuming the full row is needed — narrow it, don't skip it.
- **[M] The events processor scales worst in the tick, and is now two-thirds of it** — ~7× the cost for
  4× the systems; its share went 19.4% → 67.5% as everything around it was hollowed out. At 10,000+ systems
  this is the wall. *Next step:* fold into the events re-point ([grand-strategy-vision.md](./planned/grand-strategy-vision.md) §4)
  rather than fixing standalone — that pass rewrites the model anyway.
  Percentages are the portable figure; absolute ms move with machine and load, so re-baseline in-run.
- **[M] Markets need a real dirty/ownership model** — the events adapter copies every market row in the
  galaxy every tick (~62,000 at 2,400 systems) and almost never writes one. The copy is **load-bearing**,
  not waste: it de-aliases rows the previous world still holds. *Next step:* a design pass on copy-on-write
  rows or a dirty flag. *Don't:* reference-identity dirty-checking — the adapter hands back fresh rows
  whether or not anything changed, so it always reports dirty. Real save-corruption risk if aliasing leaks.

**Types / correctness**
- **[M] Type `goodId` as a `GoodId` union instead of `string`** — `GOODS` is `Record<string, GoodDefinition>`,
  so `GOODS[goodId]` type-checks and never narrows to `undefined`. Not a live bug (world-gen seeds every id
  from `Object.keys`), but load-bearing at ~10 point-of-use sites since the market round-trip was deleted.
  89 declaration sites across 96 files — its own PR. *Blocked on a decision:* the save-file `deserialize`
  boundary needs a guard narrowing `string` → `GoodId` with a decided failure mode (reject the save, or drop
  the row). Don't start without settling that.
- **[S] Two build-ceiling checks assume monotonic system ownership** — the read service nets committed levels
  from the player *faction's* rows; the mutation service nets *all* rows at the system. They agree only
  because a system's owner can't change yet. Unify behind one helper before conquest or rebellion ships.
- **[S] `estStaffing` and `buildingUsed` read staffing differently for support types** — `min` over the
  grades a building actually draws, vs `count × labourFulfil` (unskilled only). Display-consistency, not
  correctness; worth one shared staffing-estimate helper.

**UI**
- **[S] Funding sliders: show the set value immediately, shorted-only exception** — today's "set X% · runs Y%"
  duplicates the number in steady state and conflates the one-cycle latch lag with genuine insolvency.
  *Next step:* needs the settlement snapshot to persist the slider values used at settlement — a
  `WorldTreasurySettlement` field, i.e. a save-format bump. Touches `FundingSlider`, the treasury processor,
  and the construction-card readout.
- **[M] Faction-screen colonise verb with map target selection** — the construction command card gets a
  colonise action entering a map target-selection mode (eligible systems highlighted, click to direct),
  explicitly not a dropdown. Needs a short interaction design pass first.
- **[S] Needs-tooltip language pass** — the needs-ledger / pop-short tooltips ship with figures plus one
  placeholder sentence, pending a nested-tooltip pass. Fold the two near-duplicate bodies (`NeedTooltip` in
  `population-panel.tsx`, `PopShortTooltipBody` in `industry-panel.tsx`) into a shared shell then.
- **[L] Paradox-style nested/pinnable deep tooltips** — tooltips whose terms are themselves hoverable,
  pinnable for comparison, backed by a cross-linking concept glossary. Needs a design doc + collaborative
  HTML-prototype pass. Core genre UI post-pivot, not polish. The theme already reserves a copper treatment
  as this system's second tier.
- **[S] Move the dev cheat-panel button to the header** — the map sidebar and other floating elements block it.
- **[S] Standardise main content panel size** — system detail should be smaller than command center.

**Audits Kai has asked for**
- **[M] Trader-hangover audit** — sweep the codebase for leftovers from the old browser space-trading
  game that don't serve the grand-strategy vision, on the three-pillar basis (population, industry,
  logistics; the player is a faction ruler, not a trader). Requested, never started. Known instances of
  the class already found this way: `quoteTrade`/spread/buy-sell columns (deleted), the map price mode
  (cut), `GOODS.volatility` (still present as unread metadata since the noise path was removed in #170).
- **[M] Logistics-pillar depth check** — the pillar is still shallow; e.g. penalised cross-unowned-space
  logistics was inherited from a retired umbrella and never built. Its own pass before calling the
  pillar done.
- **[S] §3.5 player-directed colony founding** — the mechanism (`employedGradientThreshold` speed-dial)
  ships **inert but tested**. Wire it when the player-agency phase reaches it.

**Tooling**
- **[S] Decide the simulate "equilibrium" horizon** — the quick run's 10,000-tick label sits inside
  the startup transient for high-tier consumer metrics (electronics/luxuries recoveries land
  t≈9,500-11,000; ship_frames later still). Options: extend the labelled horizon to 12-16k
  (+20-60% runtime on every run) or keep 10k and rely on the documented trap (memory
  `measurement-traps`, "The horizon"). Kai's call; surfaced 2026-08-03.
- **[M] System-finder dev tool** — queryable dev panel or `scripts/` CLI surfacing representative systems by
  characteristic (population band, economy type, deposit profile, building roster, NaN checks) with a direct
  `/system/<id>` link. Recurring need whenever generation or economy changes land.
- **[S] Age-since-founding cohort axis for the harness** — deliberately cut. Only colonies founded *during*
  a run carry a `foundedTick`, so every seeded system lands in one bucket, which at equilibrium is most of
  the galaxy. `foundingStock` already covers the in-run cohort. Revisit only if a real founding-age cohort
  is needed; it requires threading `foundedTick` onto `TickSystem` and world state (save-format).

**Parked by an explicit decision — don't re-propose as new**
- **[S] Colony seed size scaled against the housing unit** — a 2-pop seed against a 20-pop housing level
  means no colony can open looking anything but empty. Variant on record: send what the founder can spare,
  up to a whole level. Changes colonisation pacing and the AI founding policy, which is why it parked.
- **[S] Luxuries weighted higher for engineers** — Kai's point is that engineers should be *more* annoyed
  when luxuries are missing. The engineer basket already carries luxuries at 50× the per-capita rate;
  whether that is enough is demand tuning. Revisit once the galaxy isn't starving.
- **[S] `idleBufferMonths`** — the fallback lever if the tighter colony-opening absorption proves too slow.
- **[S] Decide the fate of `docs/planned/economy-specialisation-s4-guardrails.md`** — a pre-pivot
  discussion agenda (findings F1-F6, hypotheses H1-H3, a 10-item calibration lever list) paused
  2026-07-03 and never resumed. **Its entire evidence base is unverifiable**: every figure was measured
  against a live Postgres world via `npm run audit:economy`, and neither the database nor the script
  exists any more. The doc now carries a warning header saying so. Read the questions, discard the
  numbers, and either re-measure the survivors with `npm run simulate` or delete it.

**Deferred / conditional**
- **[M] Switchable faction relation model** — `FactionRelation` stores one symmetric `score` per pair. If
  asymmetric opinion matters (one-sided grudges, vassalage), switch to per-direction scores. Reevaluate when
  diplomacy or war is specced.
- **[S] Flow-overlay particle thresholds vs economy scale** — the map particle constants are tuned for S=1 and
  intentionally not scaled by `ECONOMY_SCALE` (client-side visuals; the knob is server-only). At S≈100 every
  edge pins at max and the overlay loses its volume contrast — legibility only, not perf or correctness.
