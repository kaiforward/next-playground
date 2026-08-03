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
  an ordinary (non-exporter) donor keeps for itself before donating; sibling of
  `EXPORT_RESERVE_COVER` (10) — both are warehouse policy in cycles of real demand; equal to
  `WAREHOUSE_COVER` and `TARGET_COVER` today **by choice**, each free to move independently; the
  production brake deliberately remains price-anchored (`HOLD_COVER × targetStock`) — roadmap
  item 2 owns that line.
- The reserve figure is `DONOR_RESERVE_COVER × max(0, demand) × anchorMult`, derived once in
  `toGoodMarketStates` as a new `donorReserve` field on `GoodMarketState` (and optional on
  `BuildGoodState`, tick path always supplies it) — the same carrying pattern as
  `logisticsTarget`. `anchorMult` is included so an event that shifts a market's anchors moves the
  reserve coherently with the warehousing target — this matches the measured variant.
- `surplusDrawable` ordinary-donor branch: margin test `stock ≥ SURPLUS_MARGIN × donorReserve`,
  drawable `stock − donorReserve`. The `targetStock <= 0` guard and the exporter branch stay
  byte-identical. After this change `targetStock`'s only read in the function is that degenerate
  guard — flag for roadmap item 2's pass, do not touch here.
- The build planner's `effectiveBuildSystems` adjusts `demand` for queued output without
  recomputing the carried reserve — deliberate, matching the measured variant; the input-supply
  gate is a coarse eligibility test.
- **Fidelity requirement:** at `DONOR_RESERVE_COVER = 40` this is formula-identical to the
  measured variant (which passed `logisticsTarget` = `WAREHOUSE_COVER(40) × demand × anchorMult`
  as the anchor), so the M-series evidence carries over to the shipped shape. Any deviation from
  that formula voids the evidence and needs remeasurement.
- Docstrings updated: `surplusDrawable`'s KNOWN-WRONG narrative is replaced by the decision record
  (equilibrium-neutral, transient cost accepted, horizon artifact explained in one line);
  `GoodMarketState.targetStock`'s "only surplusDrawable still reads it" note updated.

## Design-hazards worksheet

### 1. One quantity, several unrelated jobs

`npm run impact` outputs, 2026-08-03:

| Quantity | Every reader today | Which this design moves | Intended? |
|---|---|---|---|
| `surplusDrawable` | matcher donor side (`directed-logistics.ts:223`), build input-supply gate (`directed-build.ts:694`), founding manifest (`processors/directed-build.ts:111`) | all three, via the one shared definition | Yes — all three measured together and per-caller (R1–R4); keeping one definition is deliberate, per the measured evidence that per-caller behaviour interacts |
| `WAREHOUSE_COVER` | constant (`constants/directed-logistics.ts:47`), `logisticsTarget` derivation (`good-market-state.ts:48`) | none — the new constant is authored separately precisely so this stays single-jobbed | Yes (decision 2) |
| `SURPLUS_MARGIN` | sink-side classifier (`directed-logistics.ts:41`), donor margin (`:98`), harness surplus-share metric (`market-analysis.ts:250`) | none moved; the donor margin's *base* changes under it | Yes — margin stays the shared "deliberate dead-band" knob; recorded that it has three readers |
| `targetStock` (price anchor) | pricing curves; after this change, in `surplusDrawable` only the `<= 0` guard | donor-side read removed | Yes — that is the point of the change |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same? |
|---|---|---|---|
| `WAREHOUSE_COVER` | "warehouse policy stated in cycles of real demand… free to move apart [from TARGET_COVER]" | value precedent only; not read by the new code | Yes |
| `EXPORT_RESERVE_COVER` | exporter's own-demand reserve, "well above RATION_COVER" | untouched sibling; naming/semantics pattern for the new constant | Yes |
| `SURPLUS_MARGIN` | "surplus when stock ≥ targetStock × this… deliberate residual (negative space)" | same margin, applied to the new reserve base | Yes — the residual/negative-space intent transfers |
| `MIN_DEMAND` | divide-by-zero guard on the *pricing* denominator | stops reaching the donor decision entirely | Yes — removing a hazard-2 instance |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | Yes — `anchorMult` scales the reserve, so anchor-shifting events move donor willingness with warehousing targets (chosen; matches measured variant) | |
| Population + migration | Indirect — supply timing during the scarcity era shifts satisfaction (Supplied 169 vs 209 @10k, converged by 16k; mean D 0.030 vs 0.027 @10k) | |
| Unrest / regime | Same channel as population; no direct read | no code path reads donor thresholds |
| Industry + staffing | No direct read; build *eligibility* via the gate is measured (R3 alone harmless; full edit: tier-1+ 530 vs 525, levels 2,688 vs 2,621 at 10k, converging by 16k) | |
| Infrastructure decay | None direct — decay reads idle cycles/production, not donor thresholds; indirect supply-timing path covered by the measured equilibrium parity (levels/production flat) | |
| Directed logistics | The change itself — donor side only; sink classification untouched | |
| Directed build / planner | Caller 2 (input-supply gate) — measured per-caller and combined | |
| Colonisation + founding manifest | Caller 3 — measured; founding stats identical in every run (562 colonies, opening satisfaction 0.42–0.43, deprived 380) | |
| Treasury / purse | None — donor rule reads no funding; logistics funding was 100% in all runs | no shared quantity |
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
| `anchorMult` | market row, written by events *during* the tick (2nd of 9) | ≥ 0 multiplier | read where the matcher reads it (post-events), same as `logisticsTarget` today |
| `targetStock` | `marketBandForRow` | floored ≥ `MIN_DEMAND`-derived | only the `<= 0` degenerate guard |
| `production`, `productionSuppressed` | economy assessment, persisted on row | realized rate; suppression flag | unchanged exporter-branch inputs |

### 6. Aggregates this will be judged on

| Metric | Read at which cohort | What else moves it |
|---|---|---|
| consumer median cover, per good | consumer role, per good, **at ≥12k or as a trajectory** — never the 10k point (the horizon trap this work found) | cohort mix (consumer n moved 152↔138 between runs); horizon phase; seed |
| Supplied/Rationing share | per settled system, both horizons + 12k+ | startup transient; cohort mix (split by world cohort) |
| logistics totals | whole-run | saturation means totals are insensitive — composition (per-role inbound) is the sensitive read |

## Tests

- Rewrite the two matcher-level tests that pin the ordinary donor to the price anchor — they must
  fail against this change and be re-pinned to the reserve (cheapest proof: run them before the
  rewrite and watch them fail).
- Keep the pure-exporter pinning test ("keeps a pure exporter shipping…") — it guards the
  `targetStock <= 0` trap.
- New: an ordinary donor is never drained below `DONOR_RESERVE_COVER × demand × anchorMult`; a
  below-floor market with stock above `SURPLUS_MARGIN ×` reserve is drawable (the
  previously-sheltered case — this is the behavioural change, so break it deliberately to see the
  test fail).

## Verification

`npm run simulate` on seed 42 plus two fresh seeds. Both standard horizons read as always, **plus**
high-tier consumer cover judged at ≥12k or by trajectory (a `--config` experiment run, or the
session's diag pattern) — never the 10k point alone. Expected: per-good equilibrium parity with
each seed's own baseline; the delay signature present and bounded (~1–2k ticks); shipping totals
~flat; coarse health bar clean (no NaN/runaway/pinning). The pending simulate-horizon decision
(extend the labelled equilibrium horizon vs keep 10k with the documented trap) is Kai's open call
and not blocked by this.

## Out of scope

The production brake (roadmap item 2), sink ordering / player flow-priority (pricing-vs-logistics),
the simulate horizon change (Kai's pending decision), price-as-a-signal (pricing-vs-logistics
question 4).

Lifecycle: transient — on ship, fold the mechanics into
`docs/active/gameplay/economy-autonomic-agency.md`, update `docs/SPEC.md`'s interaction map, and
delete this file and the evidence working file after carrying durable outcomes.
