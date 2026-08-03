# surplusDrawable's three callers — which one produces the electronics regression?

Working file for roadmap item 1 (economy queue). Transient: deleted when the item ships, after
carrying durable outcomes into `docs/active/gameplay/economy-autonomic-agency.md`, the roadmap row,
or the `killed-designs` memory.

Context (from the item + `surplusDrawable`'s docstring): #211 moved the deficit side onto
`WAREHOUSE_COVER × real demand`; the donor side still reads the `MIN_DEMAND`-floored price anchor,
deliberately. Removing that floor was tried in session 63: a no-op for shipping (+0.0% drawable,
96.5% of hauls come from the exporter branch that never reads the target), yet `electronics`
consumer cover fell 0.78 → 0.21 and the cause was never established. The edit moved all three
callers at once. This measurement isolates them.

## Claim

Under a demand-denominated ordinary-donor anchor, the electronics consumer-cover collapse
(0.78 → 0.21 at equilibrium) is produced by the **build planner's input-supply gate** caller of
`surplusDrawable`, not by the logistics matcher's donor side or the colony founding manifest.

Why this caller is the named suspect (the lead being formalised, not evidence): build-loop stats
moved with the tried edit (tier-1+ industry 525 → 530, colony tier-1 projects 51 → 31), and the gate
is the one *binary* caller — `surplusDrawable(...) > 0` decides which systems count as reachable
input suppliers for tier-1+ industry, so small anchor changes can flip site eligibility outright.

## Falsifier, committed before any run

Five runs, all `npm run simulate` at the standard config (600 systems, seed 42,
`ECONOMY_SCALE=100`), reading the **electronics consumer-cohort median cover at equilibrium**,
startup recorded alongside:

- **R0** baseline, no edit — validity gate: must reproduce 0.70–0.86 (known 0.78). Miss ⇒
  INCONCLUSIVE (config drift): fix the instrument, do not reinterpret.
- **R1** all three callers on the demand anchor — validity gate: must reproduce ≤ 0.35 (known 0.21).
  Miss ⇒ INCONCLUSIVE (the reconstruction of the tried edit is wrong): back to the instrument.
- **R2** matcher only · **R3** build gate only · **R4** founding manifest only.

**The claim is FALSE if either:**

- R3 (gate only) reads **≥ 0.60** at equilibrium — the gate alone does not carry the regression; or
- R2 or R4 reads **≤ 0.40** at equilibrium — another caller carries it, alone or additionally.

A compound outcome — R1 reproduces but no single-caller run reads ≤ 0.40 — falsifies the claim as
stated (the regression needs two callers together). That is a finding, not a rescue.

Secondary discriminators, recorded per run but not falsifier bars: `ship_frames` consumer-empty %,
colony tier-1 project count, tier-1+ industry count, supplied %, waste.

## Variant under test (the reconstruction)

`surplusDrawable` gains a temporary optional `demandAnchor` argument used only by the
ordinary-donor branch (`anchor = demandAnchor ?? targetStock`, for both the margin test and the
subtrahend). The `targetStock <= 0` guard and the exporter branch are untouched — the tried edit
was a shipping no-op, so the guard cannot have moved. Call sites under test pass
`logisticsTarget` (`WAREHOUSE_COVER × real demand × anchorMult`, unfloored — the same figure the
deficit side moved to in #211); `BuildGoodState` gains a temporary optional `logisticsTarget`
field to carry it through the build planner. All edits are measuring instrument, never committed,
reverted before write-up.
