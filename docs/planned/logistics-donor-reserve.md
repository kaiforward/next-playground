# Donor reserve — the giving-away rule leaves the price anchor

One rule changes: **how much a non-exporter market will give away.** Today an ordinary donor keeps
stock up to the *pricing* anchor — a figure floored at `MIN_DEMAND`, so on small markets it is set
by a divide-by-zero guard rather than by anything anyone there consumes. After this change it keeps
`DONOR_RESERVE_COVER` cycles of its **own real demand** and donates only the excess, still gated by
`SURPLUS_MARGIN`. Exporters keep their existing 10-cycle rule, the deficit side is untouched (it
moved to real demand in #211), the production brake is untouched, and who-gets-served-first is
untouched. This completes #211's decoupling: pricing no longer participates in any physical
logistics decision.

Measured effect (full chain: [surplusdrawable-three-callers.md](../build-plans/surplusdrawable-three-callers.md)):
**identical equilibrium on every tracked good**; the one real cost is transient — consumer-shelf
fill in the scarcity era arrives ~1,000–2,000 ticks (~40–80 cycles) later, because previously
over-sheltered small-market stock now feeds the front of the severity queue.

## Decisions (Kai, 2026-08-03)

1. **Transient cost accepted** as a pace change. Named caveat: mid-transient satisfaction dips
   measurably (Supplied 169 vs 209 systems at t=10,000, seed 42) before converging.
2. **A new authored constant**, not a borrowed one. `DONOR_RESERVE_COVER` is its own number —
   donor policy stops piggybacking on the warehousing target the way it piggybacked on the price
   anchor. Shared variables are the project's most-repeated defect (hazard 1).
3. **The production brake does not move.** `productionCeiling` keeps throttling at
   `HOLD_COVER × price anchor`. Whether the brake should ever leave the price anchor is roadmap
   item 2's own measured, open question — this change must not smuggle it in. The resulting
   cross-denominated relationship is documented at the constants (see Mechanics) and is
   near-vacuous in practice: brake-vs-donor-line only interacts on producers that are not
   exporters, and below the demand floor that set is almost empty.
4. Sink prioritization (severity ordering, player control over flow priority) is out of scope —
   recorded as Kai's input in [pricing-vs-logistics.md](../build-plans/pricing-vs-logistics.md).

## Mechanics

- `DIRECTED_LOGISTICS.DONOR_RESERVE_COVER = 40`. Docstring must state: cycles of **real demand**
  an ordinary (non-exporter) donor keeps for itself before donating; sibling of `WAREHOUSE_COVER`
  — both are demand-denominated logistics policy that **rides `anchorMult`**; equal to
  `WAREHOUSE_COVER` and `TARGET_COVER` today **by choice**, each free to move independently
  subject to the invariant below; the production brake deliberately remains price-anchored
  (`HOLD_COVER × targetStock`) — roadmap item 2 owns that line. `EXPORT_RESERVE_COVER` is the
  naming/denominator precedent only — this constant knowingly departs from its anchor-shift
  immunity (see the worksheet row-2 entry).
- **Invariant, stated because decision 2 makes the constants free to diverge:**
  `DONOR_RESERVE_COVER ≥ WAREHOUSE_COVER × DEFICIT_FRACTION` (40 ≥ 32 today). Below it, a donor
  drained to its reserve immediately registers as a deficit sink and is refilled — a drain/refill
  loop, not a dead-band; the shipped `HOLD_COVER`/`SURPLUS_MARGIN` accident with the roles
  reversed. Pin it in `lib/constants/__tests__/band-constants.test.ts` alongside the existing
  logistics invariant at :43, with the reason in the test body, and state it in the constant's
  docstring.
- The reserve figure is `DONOR_RESERVE_COVER × max(0, demand) × anchorMult`, derived once in
  `toGoodMarketStates` as a new **required** `donorReserve` field on `GoodMarketState`, and an
  **optional** one on `BuildGoodState` — the carrying pattern of `civilianDemand` and `production`
  (`directed-build.ts:45-56`), optional there for engine fixtures while the tick path always
  supplies them. (`logisticsTarget` itself is *not* on `BuildGoodState`; the measured variant had
  to add it temporarily, which is why `donorReserve` is added permanently here.) `anchorMult` is
  included so an event that shifts a market's anchors moves the reserve coherently with the
  warehousing target — this matches the measured variant.
- **Signature:** `surplusDrawable(stock, targetStock, donorReserve, demand, production,
  productionSuppressed = false)` — `targetStock` stays only for the `<= 0` guard. The build-gate
  call site (`directed-build.ts:694`) resolves an absent optional field as
  `g.donorReserve ?? DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * Math.max(0, g.demand)` — an
  anchorMult-free reconstruction, so an engine fixture that omits the field is governed by the
  **new** rule rather than silently retaining the old one. State this at the field's docstring.
  `?? targetStock` is expressly rejected: it would make the new pinning test vacuous wherever the
  field is absent.
- `surplusDrawable` ordinary-donor branch: margin test `stock ≥ SURPLUS_MARGIN × donorReserve`,
  drawable `stock − donorReserve`. The `targetStock <= 0` guard and the exporter branch stay
  byte-identical. After this change `targetStock`'s only read in the function is that degenerate
  guard — flag for roadmap item 2's pass, do not touch here.
- **Degenerate case, stated deliberately:** at `demand === 0` the reserve is 0, the
  `SURPLUS_MARGIN` test is vacuous, and the market's entire stock is drawable. Intended — there is
  no local consumption to hold stock for, it mirrors what the exporter branch already does at
  demand 0 (pinned at `directed-logistics.test.ts:481`), and it is what the measured variant did,
  so the M-series evidence covers it. Two consequences to record in code: (a)
  `classifyMarketState`'s docstring principle that a zero-target market is "neither a sink nor a
  source" now holds only on the **sink** side — amend that docstring
  (`directed-logistics.ts:29-31`); (b) `SURPLUS_MARGIN`'s authored residual is proportional to the
  new base and degenerates to nothing as demand → 0.
- The build planner's `effectiveBuildSystems` adjusts `demand` for queued output without
  recomputing the carried reserve — deliberate, matching the measured variant; the input-supply
  gate is a coarse eligibility test.
- **Fidelity requirement:** at `DONOR_RESERVE_COVER = 40` this is formula-identical to the
  measured variant (which passed `logisticsTarget` = `WAREHOUSE_COVER(40) × demand × anchorMult`
  as the anchor), so the M-series evidence carries over to the shipped shape. Any deviation from
  that formula voids the evidence and needs remeasurement.
- Docstrings and narrative updated at **every** live site carrying the retired KNOWN-WRONG story:
  `surplusDrawable` (`engine/directed-logistics.ts:47-84` — narrative replaced by the decision
  record: equilibrium-neutral, transient cost accepted, horizon artifact in one line);
  `GoodMarketState.targetStock` (`:110-113`); `WAREHOUSE_COVER`'s docstring
  (`constants/directed-logistics.ts:26` — drop "The donor side still reads the price anchor —
  known-wrong"); the `toGoodMarketStates` module header (`processors/good-market-state.ts:10-13`);
  `BuildGoodState.targetStock` (`engine/directed-build.ts:39-42` — now describes the guard only);
  the pinning-block comment at `engine/__tests__/directed-logistics.test.ts:171-175`;
  `classifyMarketState`'s zero-target paragraph (`engine/directed-logistics.ts:29-31`, sink-side
  only — see the degenerate case). In `docs/SPEC.md`, the Economy → Directed Logistics bullet's
  "donor never drawn below its anchor" becomes "donor never drawn below its own reserve".

## Design-hazards worksheet

### 1. One quantity, several unrelated jobs

`npm run impact` outputs, 2026-08-03:

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `surplusDrawable` | matcher donor side (`directed-logistics.ts:223`), build input-supply gate (`directed-build.ts:694`), founding manifest (`processors/directed-build.ts:111`) | all three, via the one shared definition | Yes — all three measured together and per-caller (R1–R4); keeping one definition is deliberate, per the measured evidence that per-caller behaviour interacts |
| `WAREHOUSE_COVER` | constant (`constants/directed-logistics.ts:47`), `logisticsTarget` derivation (`good-market-state.ts:48`) | none — the new constant is authored separately precisely so this stays single-jobbed | Yes (decision 2) |
| `SURPLUS_MARGIN` | sink-side classifier (`directed-logistics.ts:41`), donor margin (`:98`), harness surplus-share metric (`market-analysis.ts:250`) | none moved; the donor margin's *base* changes under it | Yes — margin stays the shared "deliberate dead-band" knob; recorded that it has three readers |
| `targetStock` (price anchor) | pricing curves (`market-pricing.ts:28-66`, `market-tick-builder.ts:86`); the production brake `productionCeiling(stock, targetStock, HOLD_COVER)` (`industry.ts:710`, `engine/tick.ts:77-104`, `supply-chain.ts:122`) — decision 3 deliberately leaves this on the anchor; the initial market-seed reserve (`market-economy.ts:130-131`); `economy.ts:207`; harness cover metrics (`market-analysis.ts:120,:237`, `cohort-analysis.ts:159`); after this change, in `surplusDrawable` only the `<= 0` guard (36 refs / 10 modules, `npm run impact -- targetStock`, 2026-08-03) | donor-side read removed; every other reader untouched | Yes — that is the point of the change |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `WAREHOUSE_COVER` | "warehouse policy stated in cycles of real demand… free to move apart [from TARGET_COVER]" | value precedent only; not read by the new code | Yes |
| `EXPORT_RESERVE_COVER` | "cycles of its own demand a structural exporter keeps… **Stated in cycles it is also immune to `anchor_shift` events, which move the price anchor and have no business moving warehouse policy**" | naming/denominator pattern only — the new constant deliberately DEPARTS on anchor immunity | **No, and knowingly**: `donorReserve` multiplies by `anchorMult` so it tracks `logisticsTarget` (`good-market-state.ts:48`) — the figure the deficit side measures against. Deficit line and donor floor moving together under an anchor event is the property being bought; it is also what the measured variant did, so departing from it would void the M-series evidence |
| `SURPLUS_MARGIN` | "surplus when stock ≥ targetStock × this… deliberate residual (negative space)" | same margin, applied to the new reserve base | Yes above the demand floor; the residual is proportional to the new base and **vanishes at demand 0** — see the degenerate case in Mechanics |
| `MIN_DEMAND` | divide-by-zero guard on the *pricing* denominator | stops reaching the donor decision entirely | Yes — removing a hazard-2 instance |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | Yes — `anchorMult` scales the reserve, so anchor-shifting events move donor willingness with warehousing targets (chosen; matches measured variant) | |
| Population + migration | Indirect — supply timing during the scarcity era shifts satisfaction (Supplied 169 vs 209 @10k, converged by 16k; mean D 0.030 vs 0.027 @10k) | |
| Unrest / regime | Same channel as population; no direct read | no code path reads donor thresholds |
| Industry + staffing | No direct read; build *eligibility* via the gate is measured (R3 alone harmless). Full edit @10k: tier-1+ industry 530 vs 525, building levels 2,688 vs 2,621, colony tier-1 projects **31 vs 51 (−39%)**. At 16k the raw diag series shows levels 2,628 vs 2,599 and realized 752.5K vs 771.6K (converged within ~1-2.5%); **colony tier-1 project counts have no 16k read anywhere** — verification must take build-loop metrics at the same 12k+ horizon as the cover metrics | |
| Infrastructure decay | None direct — decay reads idle cycles/production, not donor thresholds; indirect supply-timing path covered by the measured equilibrium parity (levels/production flat) | |
| Directed logistics | The change itself — donor side only; sink classification untouched | |
| Directed build / planner | Caller 2 (input-supply gate) — measured per-caller and combined | |
| Colonisation + founding manifest | Caller 3 — measured; founding stats identical in every run (562 colonies, opening satisfaction 0.42–0.43, deprived 380) | |
| Treasury / purse | Reads none. **Writes one, indirectly:** `wanted = min(shortfall, drawable)` (`directed-logistics.ts:268`) feeds the budget-bound test, and `logisticsFundingBound` is stamped on BOTH endpoints (`processors/directed-logistics.ts:121-122`), including the donor; the build planner reads it to suppress its feedback gap (`directed-build.ts:314`). A larger ordinary-donor drawable changes which markets read as funding-bound and hence which structural deficits get proposed — a fourth pathway into the build loop. Covered end-to-end by the R1-R4 runs, but at 100% logistics funding — the least-binding setting. **Re-read this path if funding ever binds.** | |
| Factions + relations | Matcher scoping (per-faction) unchanged; the reserve is per-market | |
| Save format (`World` shape) | None — `donorReserve` is derived per tick in `toGoodMarketStates`, never persisted | derived field |
| Harness's own metrics | Cover metrics keep the price-anchor denominator (a reporting convention, unchanged); `market-analysis.ts:250` surplus-share still reads `SURPLUS_MARGIN` against price-anchor cover — after this change that metric no longer describes the donor rule for ordinary donors; acceptable, noted for the harness backlog | |

### 4. Symptoms and claims, with measurements

All from [surplusdrawable-three-callers.md](../build-plans/surplusdrawable-three-callers.md), seed
42, 600 systems, `ECONOMY_SCALE=100`:

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| Equilibrium-neutral | electronics consumer 0.90/0.90, luxuries 0.88/0.87, ship_frames 0.85/0.82, components 0.93/0.95 | 16,000t | consumer role, per good |
| Production untouched | realized 786.9K vs 784.7K (−0.3%) | 10,000t | galaxy, electronics |
| Transient delay ~1–2k ticks | variant 0.21 @10k → 0.75 @11k → 0.85 @12k (baseline 0.78 → 0.87 → 0.85) | trajectory | electronics consumers |
| Mechanism: flow diversion at flat totals | totals 53.55M vs 53.81M; into-consumers −42%; into-self-suppliers +11.4% (143% of the drop); below-floor-sourced +61% | window t=5,000–5,500 | per-haul, all goods / electronics |
| Session-63 "collapse" was a horizon artifact | 10k sits mid-transient for high-tier consumer cover (baseline luxuries 0.34 @9.5k → 0.81 @10k) | trajectory | consumer role |
| Single-seed limitation | all of the above | — | seed 42 only — verification below adds seeds |

### 5. Signals/primitives consumed

| Consumes | Produced at | Actual shape | Design assumes |
|---|---|---|---|
| real `demand` | `good-market-state.ts:41` (civilian + industrial) | ≥ 0, unfloored; legitimately near-0 on small worlds | same |
| `anchorMult` | derived from event modifiers by `aggregateModifiers` (`engine/events.ts:158-183`) and WRITTEN onto the market row by the **economy** processor (3/9) via `adapters/memory/economy.ts:139`; events (2/9) supplies the modifiers but writes no row | clamped **[0.1, 4.0]** (`constants/events.ts:101,103`) — never 0, so an event can never zero the reserve; finite-guarded on write | read at 6/9 (logistics) and 7/9 (build), post-events and post-economy, identically to `logisticsTarget` today |
| `targetStock` | `marketBandForRow` | floored ≥ `MIN_DEMAND`-derived | only the `<= 0` degenerate guard |
| `production`, `productionSuppressed` | economy assessment, persisted on row | realized rate; suppression flag | unchanged exporter-branch inputs |

### 6. Aggregates this will be judged on

| Metric | Read at which cohort | What else moves it |
|---|---|---|
| consumer median cover, per good | consumer role, per good, **at ≥12k or as a trajectory** — never the 10k point (the horizon trap this work found) | cohort mix (consumer n moved 152↔138 between runs); horizon phase; seed |
| Supplied/Rationing share | per settled system, both horizons + 12k+ | startup transient; cohort mix (split by world cohort) |
| logistics totals | whole-run | saturation means totals are insensitive — composition (per-role inbound) is the sensitive read |
| below-floor / inert cohort stock and count, per good | the `inert` role in `computeRoleCoverLevels` (`cohort-analysis.ts:48-52`) — the set this change acts on DIRECTLY, the only one whose thresholds actually move | it carries no cover reading at all (`cohort-analysis.ts:152-156` `continue`s before pushing a cover), so nothing else in this table can see it; **total stock held on inert markets is the readable proxy** |

## Tests

- Rewrite the **one** matcher-level test that pins the ordinary donor to the price anchor
  (`lib/engine/__tests__/directed-logistics.test.ts:196`, "sizes an ordinary donor's drawable off
  the price anchor…") — it must fail against this change and be re-pinned to the reserve
  (cheapest proof: run it before the rewrite and watch it fail). Keep `:177` ("keeps a pure
  exporter shipping…") **unchanged** — it takes the exporter branch and guards the
  `targetStock <= 0` trap. Its companion comment block at `:171-175` says "both fail if
  repointed"; that was written against a naive full repoint and must be rewritten for this
  design's guard-preserving shape.
- Update, without changing their intent, every other test call site that must supply the new
  argument: `directed-logistics.test.ts` :371, :372, :377, :388, :393, :425;
  `engine/__tests__/directed-build.test.ts` :488, :497; `tick/processors/__tests__/directed-build.test.ts`
  :1085, :1114. State per site whether its verdict is expected to change —
  `engine/__tests__/directed-build.test.ts:497` is the one whose verdict depends on the fallback
  in Mechanics (with the specified anchorMult-free reconstruction, its verdict is preserved).
- New: an ordinary donor is never drained below `DONOR_RESERVE_COVER × demand × anchorMult`; a
  below-floor market with stock above `SURPLUS_MARGIN ×` reserve is drawable (the
  previously-sheltered case — this is the behavioural change, so break it deliberately to see the
  test fail); the constant invariant pin in `band-constants.test.ts` (see Mechanics).

## Verification

`npm run simulate` on seed 42 plus two fresh seeds. Both standard horizons read as always, **plus**
high-tier consumer cover judged at ≥12k or by trajectory (a `--config` experiment run, or the
session's diag pattern) — never the 10k point alone. Expected: per-good equilibrium parity with
each seed's own baseline; the delay signature present and bounded (~1–2k ticks); shipping totals
~flat; coarse health bar clean (no NaN/runaway/pinning). Additionally:

- **Build-loop metrics at 12k+** on each seed — tier-1+ industry, building levels, and colony
  tier-1 project counts (the −39% @10k mover has no 16k read today; this closes it).
- **Inert-cohort observability**: record galaxy total stock held on inert-role markets at both
  horizons. Calibrated against the measured runs' 16k CSVs (checked at review-apply time): at
  equilibrium the honest expectation is **parity within noise** — electronics inert stock read
  2,426 vs 2,609 and below-floor 114K vs 120K across baseline/variant, i.e. the release washes
  out like every other metric; the release signature lives in the **transient** (below-floor-
  sourced flow +61% in the mid-game window). The alarm is a **large sustained equilibrium rise**
  (stock stranding), not any rise; a mid-game read or flow-composition window is the place to see
  the release itself.

The pending simulate-horizon decision (extend the labelled equilibrium horizon vs keep 10k with
the documented trap) is Kai's open call and not blocked by this.

## Out of scope

The production brake (roadmap item 2), sink ordering / player flow-priority (pricing-vs-logistics),
the simulate horizon change (Kai's pending decision), price-as-a-signal (pricing-vs-logistics
question 4).

Lifecycle: transient — on ship, fold the mechanics into
`docs/active/gameplay/economy-autonomic-agency.md`, update `docs/SPEC.md`'s interaction map, and
delete this file and the evidence working file after carrying durable outcomes.
