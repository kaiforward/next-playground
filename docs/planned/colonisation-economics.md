# Colonisation economics — founding stops being free

**Founding a colony becomes a priced strategic decision.** Committing to a colony costs money once
(a charter), and building it costs money, materials and construction work continuously until it
opens — all drawn from the same treasury, warehouses and construction pool as everything else the
faction wants to do. Pacing emerges from those costs competing: nothing authors a founding rate.
The AI founding policy weighs the full price against its treasury before proposing each candidate,
so a poor faction stops expanding on its own, and a founding in progress can stall and resume when
the money or the materials run short.

Measured basis: `docs/build-plans/colonisation-economics.md` (the row-10 `/measure` baseline).
Every scale anchor cited below carries its horizon and cohort there.

## What changes, functionally

Today a colony's total cost is: 68 construction work points (billed generically at 4/point ≈ 272
over the establish), a one-shot goods manifest raided from the founder's warehouses at completion,
and a conserved 2-pop seed. No treasury is ever debited on the founding path (measured: exactly two
writers of `balance` exist, neither reachable from founding), and founding-era treasuries hold ~9.4
cycles of spend that nothing touches. The result is 562 colonies founded as an undecided burst,
done by t≈3,700.

This spec adds two cost streams and re-shapes a third:

1. **Charter fee — money, once, at commitment.** Debited when the establish project first receives
   funding, in the same step that puts the project on the queue: the project is committed and paid
   for atomically, or neither happens. Autonomic proposals that never fund never pay. The fee is
   scaled to the faction's own standing size — a multiple of its last settlement's **maintenance**
   bill, floored by a constant — so it tracks how much faction there is to administer, not how much
   the faction happens to be founding right now. This is the felt decision moment (the
   Stellaris-outpost beat) and it is by design the **dominant** monetary cost: at founding-era
   scales the charter runs ≈595 against a material bill of ≈115–195 for the same colony, roughly
   3–5:1.

2. **Materials — staged per cycle, paid at reference prices.** The founding manifest stops being a
   one-shot raid at completion. Each cycle, the project stages a share of the manifest matched to
   the construction work it absorbs: drawn from the founder's warehouses under the same
   `surplusDrawable` cap per draw as today, and **paid for** — the treasury is debited the staged
   quantity's value per good as it stages. Materials gate work, not the other way round: a cycle's
   work absorption is capped by what can actually be staged and paid for that cycle, so ships,
   temporary surface infrastructure and the seed housing are physically fed as they are built. The
   staged goods are the colony's opening endowment; the target is unchanged
   (`FOUNDING_STOCK_COVER` = 30 cycles of the seed's raw consumption), and because ~17 draws land
   against a regrowing stock instead of one, the endowment a colony actually opens with is expected
   to **rise** toward that target.

3. **Establish work — unchanged.** Still 68 points from the shared per-faction pool, ROI-ordered
   against ordinary builds, billed generically through the construction band. Deliberately kept
   generic: the colony-specific money is the charter and the materials; the band stays one bill.

Both new debit sites are true sinks — money leaves the world, there is no counterparty. That is
deliberate, and it is honestly a **founding-era** effect only: founding is a startup burst, so the
sink drains during the burst and stops. It does not and cannot address the equilibrium hoard
(487–759× cycles of spend); a one-time sink is ~1% of an equilibrium balance. Recurring sinks are
the sibling mechanics' job (priced logistics, military, industry pricing), not this row's.

### The decision side — the AI prices each candidate against a running balance

The gate lives **inside** `planFactionColonyProposals`, per candidate, beside the existing physical
gates — it cannot run ahead of the planner, because the projected material bill needs the
land-capped `seedPop` and the source market set that only the planner knows. The faction's balance
reaches it through `ColonyEstablishParams`.

Gate-first, per the `Proposal`/ROI rubric (enablers raise cost or gate eligibility, never value): a
candidate is proposed only while the faction's **working balance** covers the charter plus
`FOUNDING_GATE_HEADROOM` × the candidate's projected material bill. The working balance is a real
per-faction running budget down the ROI-ordered candidate list: each accepted candidate decrements
it by its own `charter + headroom × projected bill`, and the first candidate that fails the check
ends the list — it and everything below it drop that cycle. Without that running budget a faction
that can afford one colony commits several and pays several charters; the goods side already solves
the identical problem with `foundingStockBalance`.

The ROI value axis and the `work` denominator are untouched — money does not enter the value
scalar, so no invented money→output exchange rate. A rich faction sequences colonies against its
other spending; a broke one proposes none until it recovers. The existing physical gates (settler
supply, habitable floor, claim rate) all stand beneath this.

The projected bill is deliberately an **upper bound**: it values the *uncapped* manifest want
(≈244 t at S=100, against a realised draw of 112–145 t today), because what the founder will
actually be able to spare over ~17 cycles is not knowable at proposal time. Over-reserving is the
safe direction. If it proves to over-reserve enough to freeze founding, the fallback is to clip the
projection by the source's live `surplusDrawable` at proposal time.

Two falsifiers hold this together, both checkable in the harness:

- Σ charter debits over a run == the number of colonies that ever reached `charterPaid`. Never more.
- Σ charters committed by one faction in one cycle ≤ that faction's opening balance for the cycle.

### The player's colony verb pays the same price

`colonyEligibility` — the shared sizing service both the AI and the player go through — gains an
`insufficient_funds` block reason evaluated against exactly the formula above (charter +
`FOUNDING_GATE_HEADROOM` × projected bill), alongside the charter and projected bill as displayed
figures so the UI shows the full price before commitment. The player-facing material figure is
labelled **"up to"**, because it is the uncapped-want upper bound.

The block is a **hard** one, re-checked at the `orderColony` mutation boundary — the player cannot
commit a colony they cannot pay the charter for. With colonisation automation off (the player's
normal mode) the planner-side gate never runs for them, so without this the player faction would be
the one faction that founds for free, hold `already_forming` on the target indefinitely, and push
the maintenance floor around. Overspending is not a player freedom this design grants.

### Staging, cycle by cycle

The per-cycle order is fixed, and it runs before the construction queue is funded:

1. **Compute what is stageable.** For each in-flight `colony_establish` with `charterPaid`, per
   good: the minimum of (remaining want, the source's live `surplusDrawable` headroom, what the
   faction's working balance can pay for). Money is checked against `balance − pendingFounding`, so
   several projects in one cycle cannot each spend the same money.
2. **Convert to a work ceiling.** The ordinary absorption cap is scaled by the fraction of this
   cycle's manifest share that is actually stageable. **A good the source cannot supply this cycle
   counts as satisfied** for that fraction — it does not hold the project back; the colony simply
   lands with less of it, exactly as it does today. Without that rule the cap would deadlock the
   median colony: the founder measurably supplies only ~45–60% of the want, so a share that can
   never reach 1.0 would cap work below 1.0 forever, and the project would persist with
   `workDone > 0` while its target sat in `inFlight` permanently.
3. **Fund the queue.** The ceilings are passed to `fundQueueWithFloor` through a new optional
   `capFor?: (p) => number` callback (the existing scalar cap when omitted). The queue function
   takes one scalar cap for every project today and has no market or treasury access — the callback
   is the seam that keeps it that way.
4. **Stage what was absorbed.** The work actually absorbed per project is recovered by diffing
   `workDone` by id, exactly as `nextCycleGains` already does, and the matching manifest share is
   staged and paid for. Nothing is staged for work that was not funded.

Two new write paths carry this, and both are new because none exists today — the directed-build
processor has no market-write path and no treasury seam at all:

- **`applyFoundingStagingDraws`** — the per-cycle source debit. It clamps at debit time to the
  source's live stock, so conservation is the debit function's own property, and it appends to the
  project's `stagedManifest`.
- **A credit-only completion delivery** of `stagedManifest`, run after `addMarketsForSettledSystems`
  (the colony has no market rows before then). It must be credit-only: the existing
  `applyFoundingStock` is a conserving source→target move clamped to the source's live stock, and
  under staging the source was already debited per cycle — re-using it would double-debit the
  founder and credit `min(staged, founder's remaining stock)`, possibly zero.

**Staged goods are in-transit inventory.** Between the draw and the delivery — around 17 cycles —
they sit in the project ledger and are in no market row at either end. They are invisible to
pricing, to satisfaction, to logistics and to decay for that whole window. This is accepted, not
overlooked: it is the same treatment freight in a hold would get, and putting them in a market row
at the colony site instead would expose them to decay and to being drawn back out by logistics
before the colony exists to use them. Three readers must treat the ledger as real inventory:
cancellation (below), the save format, and the harness's tonnage accounting.

**If the source is lost** — the source system leaves the faction, or its market row for a good
disappears — that good is permanently unachievable and counts as satisfied from then on. The
project runs on work alone for the remainder and opens with whatever is already staged.

### Stall, resume, and completing on what is staged

A founding pauses — absorbs no work, stages no materials — in any cycle where it cannot pay. That
covers three cases:

- **Unpaid charter.** A project with `charterPaid === false` absorbs no work and stages nothing
  until the faction can pay. The charter is re-quoted from the *current* last settlement at the
  moment it is actually paid, not from the quote at proposal.
- **No money for the next staging share.** The staging draw is scaled down to what the working
  balance covers; at zero it is a full pause. `balance` never goes negative — a purchase that
  cannot be paid does not happen.
- **The founder cannot spare the goods.** Handled by the achievable-want rule above: a good the
  source cannot spare counts as satisfied, so this only pauses the project when *nothing* in the
  remaining manifest is drawable.

A stalled project persists and resumes when conditions recover; nothing is refunded, nothing is
destroyed. Persist-if-funded — which drops any autonomic `colony_establish` with `workDone ≤ 0` —
would otherwise delete a charter-paid project on its first stalled cycle and re-emit it next cycle
with a fresh id, charging the charter again. **A project with `charterPaid` is exempt from the
persist-if-funded drop**, the same treatment player rows already get, and the charter debit and the
queue persistence are one atomic step.

**The escape.** A project that stages nothing for `FOUNDING_STALL_COMPLETE_CYCLES` consecutive
cycles **writes off its remaining manifest**: the unstaged remainder is treated as satisfied from
then on, the materials cap stops binding, and the project finishes on construction work alone and
opens with whatever is in its ledger. The endowment shortfall is accepted — a colony that opens
poor is a legible outcome; a colony that never opens is not. It is never cancelled, and no goods
are conjured: the write-off removes a *want*, it does not deliver anything unpaid. The stall
counter runs only once `charterPaid` is true, so a project that cannot afford its charter can never
escape into a free colony.

### Cancellation

`cancelOrder` deletes a project row outright, and work spent is lost by design. Under staging the
row also carries real goods that are already out of the founder's markets, so cancellation gains a
rule: **`stagedManifest` returns to the source's market rows, uncapped** — returning stock can
never breach a reserve, so no clamp is needed or wanted. Work and the charter are forfeit. Autonomic
rows are never cancelled; the persist-if-funded drop only fires at `workDone ≤ 0`, which is before
any staging exists. The conservation test: total founder stock is unchanged across order → stage →
cancel.

### The valuation seam

One function values goods for founding — the charter's material projection and the staging debits
both go through it. It computes

```
value(goodId, quantity) = (quantity / ECONOMY_SCALE) × GOODS[goodId].basePrice
```

The `/ ECONOMY_SCALE` is load-bearing, not cosmetic. Goods quantities ride S (`GOOD_CONSUMPTION` is
a `scaleRecord`); money does not (the treasury constants are S-invariant by construction). Every
existing quantity→money conversion normalises the same way — production tax divides `units / scale`,
logistics work is S-normalised at accrual. Without it the material bill reads ≈11,479 at the live
S=100 against a founding-era median balance of 5,592 — the gate would freeze founding galaxy-wide —
while every unit test, pinned at S=1, would read ≈115 and see nothing wrong.

It deliberately does **not** read `REFERENCE_VALUE`: that table is a cadastral *tax assessment*,
value-added net of inputs — as a procurement price it would price alloys below their inputs' sum.
Different authored meaning, wrong table.

Today the seam reads the catalog `basePrice`. When the goods-pricing revisit ships it swaps to live
local market prices with no redesign (live prices misbehave today — producers/consumers not reading
price by type properly; see the goods-pricing roadmap row).

## What deliberately does not change

- **Claims stay free and rate-capped.** A claim is a territorial intention (map paint); the priced
  act is committing to establish. Pricing claims would slow paint without adding decision weight.
- **The seed stays 2 pops, and seed-vs-housing-unit stays parked.** Staging changes founding's cost,
  not its size; un-parking the seed item would compound two pacing changes in one measurement.
  It un-parks, deliberately, only after this ships and is measured.
- **Band billing stays generic** (see stream 3). The construction band's bill is one number; the
  colony's work inside it is indistinguishable from a factory's, by design.
- **No debt.** `balance` never goes negative; a purchase that cannot be paid does not happen
  (that is the stall rule).

## Where the money lands

Both debits are applied inside `runTreasuryProcessor`, which stays the **single writer** of
`balance`. Directed build accrues them into a new `pendingFounding: number` accumulator on
`WorldFactionTreasury` on its own cycle; the treasury processor drains and zeroes it at settlement —
exactly the shape `pendingWork` already has, for exactly the same reason. Directed build also reads
it: its working balance for the gate and for staging is `balance − pendingFounding`, which is what
makes several commitments in one cycle sum correctly.

Three consequences are specified rather than left to default:

- **The processor's guards must learn about it.** The early return (`if (!settles && !hasWork)`)
  and the mid-cycle branch both currently key on pending *work* only; both gain the founding term,
  or a founding debit accrued in a workless cycle is silently dropped.
- **Founding outranks the funding ladder, deliberately.** The debit passes `safeMoney` and lands
  **before** `settleLadder`, so founding money is taken off the top and the ladder — including the
  maintenance floor — divides what is left. The alternative (settling first, founding from the
  remainder) makes founding a residual claimant and the charter stops biting during exactly the
  burst it exists to pace. The cost is real and goes on the acceptance bar: the *distribution* of
  maintenance funding during the founding era must be read, not just its median.
- **The settlement clock is not the construction clock.** `CONSTRUCTION_INTERVAL` is documented
  independent of `CYCLE_LENGTH`; that they coincide today is a configuration accident. The
  interval-invariance test cases gain a `CONSTRUCTION_INTERVAL ≠ CYCLE_LENGTH` configuration.

**The purse line.** `WorldTreasurySettlement` gains `foundingExpense: number` (charter + staging
debits settled that cycle) as its **own field** — never a fourth member of `TreasuryBands`, which is
a three-field type shared by the sliders, the bills and the latched `funded` fractions and would be
corrupted in all three. Both readers are in scope for this change, not follow-ups: the treasury
card gains a Founding `LedgerRow` alongside its three expense rows, and `services/treasury`'s
`net = income − (paid.maintenance + paid.logistics + paid.construction)` gains the founding term. A
`net` that ignores a real expense is a correctness bug, not a presentation gap.

## Player-facing readouts

`ConstructionProjectColonyRow` gains `stalledReason` (`"awaiting_charter" | "awaiting_funds" |
"awaiting_materials" | null`, derived — not persisted) and `stagedFraction` (the manifest share
staged so far). `etaCycles` reads `null` while stalled, which the field already documents as the
stalled signal. Without these the construction readout promises steady progress to a colony that is
structurally unable to make any, with no way for the player to see why or what would fix it.

## New and changed constants

All coarse first-cut, harness-calibrated, values-stay-coarse until priced logistics / military /
industry pricing land on the same treasury (per the standing calibration rule). In
`lib/constants/colonisation.ts`:

| Constant | Meaning | First-cut anchor |
|---|---|---|
| `CHARTER_FEE_SPEND_MULT` | Charter = `max(CHARTER_FEE_MIN, mult × lastSettlement.maintenanceBill)`. Maintenance, not total bill: it is a standing-stock proxy for faction size that does not move with the faction's own founding activity. The construction bill is ~78% of the founding-era total and is largely the founding burst itself, so a total-bill charter would self-reinforce during the burst and collapse at equilibrium — the opposite of a knob that stays independent | **~6.5.** Founding-era per-cycle maintenance bill, roster median, is 1,831.1 across the 20-faction roster ⇒ ≈91.6 per faction. The measured bite point is one cycle of per-faction total spend, ≈598. 6.5 × 91.6 ≈ **595** |
| `CHARTER_FEE_MIN` | A real `max()` floor on the charter, not a null-fallback — it binds for any faction whose maintenance bill has collapsed, at any horizon. (The pre-settlement case it also covers is nearly dead on its own: first settlement lands t=24, first founding t=432) | ~100 — about the scale of the material bill itself, so the cheapest possible colony still costs roughly what its goods cost |
| `FOUNDING_GATE_HEADROOM` | Propose only while the working balance ≥ charter + headroom × projected material bill | ~2.0. The projected (uncapped) bill is ≈195, so this reserves ≈390 — still below the charter. The gate is charter-dominated by design; the headroom is the secondary term, and the charter is the knob to move if founding needs slowing |
| `FOUNDING_STALL_COMPLETE_CYCLES` | Consecutive staging-nothing cycles after which a project writes off its remaining manifest and completes on what is staged | ~8 — roughly half a nominal establish (68 work ÷ absorption cap 4 = ≥17 cycles), long enough that ordinary lumpiness does not trip it |
| `FOUNDING_STOCK_COVER` (existing) | Unchanged meaning — cycles of seed raw consumption; now a **staging target** instead of a completion-time draw | 30, unchanged |

Docstring debt paid alongside: `COLONY_ESTABLISH_WORK`'s docstring calls itself "a temporary
construction stand-in until a treasury prices expansion" — this spec is that pricing; and both
colonisation/expansion constants files cite `docs/planned/economy-colonisation-cost.md`, which no
longer exists. Both docstrings get re-pointed at implementation.

## Save format

`WorldColonyEstablishProject` gains `stagedManifest` (per-good quantities staged so far),
`charterPaid` and `stalledCycles`. `WorldFactionTreasury` gains `pendingFounding`.
`WorldTreasurySettlement` gains `foundingExpense`. All JSON-serializable scalars and plain records.

**All new project fields are required, not optional.** That is what makes `tsc` enforce them at both
creation sites — the autonomic planner and the player verb — and there are exactly two.

`SAVE_FORMAT_VERSION` is bumped. Old saves fail cleanly on load: `deserializeWorld` hard-rejects any
`formatVersion` mismatch and there is no field-defaulting path to write a grandfathering rule into.
Failing loudly is the documented pre-1.0 behaviour and is the correct one here anyway — an old
save's in-flight colonies were committed under the free model, and any default this code could
choose would be a lie about whether they were paid for.

---

## Design-hazards worksheet

### 1. One quantity, several unrelated jobs

| Quantity | Every reader today (`file:line`) | Which this design moves | Intended? |
|---|---|---|---|
| `FOUNDING_STOCK_COVER` | def `lib/constants/colonisation.ts:64`; sole reader `lib/tick/processors/directed-build.ts:111` (`want = COVER × colonyDemandRate`) | The one reader: want becomes a staging target, drawn over cycles instead of at completion | Yes — same quantity, same meaning, different delivery schedule |
| `surplusDrawable` | def `lib/engine/directed-logistics.ts:87`; logistics donor matcher `:243`; build input-supply gate `lib/engine/directed-build.ts:702`; founding manifest cap `lib/tick/processors/directed-build.ts:114` | **The per-draw cap is unchanged; the aggregate draw rises.** The cap is memoryless, so ~17 draws against a regrowing stock converge toward the full want (≈1.7× today's realised 112–145 t fill) | **Deliberately kept coupled** (the known unresolved triple-duty from the hazard list): a founder's willingness to part with stock stays consistent with what logistics may draw from it. Separating it is the goods-pricing revisit's problem. The aggregate rise is intended — it is the endowment improving — and it is on the acceptance bar as founder cost |
| `basePrice` | catalog + 6 more modules, 52 references — verbatim `npm run impact` output below this table | **Adds an eighth reader and a fourth job**: the founding valuation seam, S-normalised. Nothing existing changes | Yes, deliberate — procurement at catalog price, behind one seam. The other three jobs (catalog data, price-curve anchor, tax-value derivation) are untouched; the two player trade surfaces and the two harness ratio readers see no change because the seam only *reads*. The tax table is explicitly NOT reused (hazard 2) |
| `ECONOMY_SCALE` | `lib/constants/economy-scale.ts:30`; `scaleRecord` on every goods-quantity constant (`lib/constants/physical-economy.ts:60`); normalisers at `lib/engine/treasury.ts:80` (production tax) and `lib/tick/processors/treasury.ts:74` (logistics work) | **Adds a reader**: the valuation seam divides by it, joining the existing quantity→money normalisers | Yes — this is the convention, not an exception. Money is S-invariant (`lib/constants/treasury.ts:2-5`); any quantity crossing into money divides by S first |
| `COLONY_ESTABLISH_WORK` | def `lib/constants/colonisation.ts:15`; tick params `lib/world/tick.ts:1073`; player verb sizing `lib/services/colony-eligibility.ts:45` (impact verdict: SHARED, 3 modules) | Value unchanged; the shared sizing service gains charter + material projection + the `insufficient_funds` gate alongside it | Yes — the coupling is the point: AI and player must price identical projects. The service is the single shared sizing path for both |
| `WorldFactionTreasury.balance` | writers: settlement `lib/tick/processors/treasury.ts:148`, world-gen init `lib/world/gen.ts:209` | **No new writer.** Founding debits accrue into `pendingFounding` and are applied by the settlement writer, which stays the only one. Directed build gains a *read* (`balance − pendingFounding`) for the gate and the staging affordability check | Yes. Single-writer discipline preserved; both debits pass `safeMoney` and respect balance-never-negative (can't pay → stall, never debt) |
| `CONSTRUCTION_RATE_PER_WORK` | `lib/constants/treasury.ts:26` → construction bill `lib/tick/processors/treasury.ts:120-124` | None | Establish work keeps billing exactly as today |

**Verbatim — `npm run impact -- basePrice`:**

```
TICK RIPPLE — processors that READ it via their World interface
  none — no processor reads this through its declared interface.

TICK SIMULATION — 39 references in 3 modules (+13 in tests) (+13 in comments, not counted)
  goods                          27×  lib/constants/goods.ts
  market-pricing                 9×  lib/engine/market-pricing.ts
      :28    const { basePrice, targetStock, floorMult, ceilingMult } = curve;
      :30    const min = floorMult * basePrice;
      :31    const max = ceilingMult * basePrice;
      :33    const raw = basePrice * (targetStock / stock) ** k;
  treasury                       3×  lib/constants/treasury.ts
      :84    inputCost += (GOODS[inputId]?.basePrice ?? 0) * perOutput;
      :88    def.basePrice - inputCost,
      :89    TREASURY.REFERENCE_VALUE_FLOOR_SHARE * def.basePrice,

OUTSIDE THE TICK — 13 references in 5 modules (+6 in tests) (+1 in comments, not counted)
  market-table                   7×  components/trade/market-table.tsx
  market-comparison-panel        2×  components/market/market-comparison-panel.tsx
  market-entry                   2×  lib/services/market-entry.ts
  goods                          1×  lib/services/goods.ts
  market-comparison              1×  lib/services/market-comparison.ts

HARNESS + TESTS — 2 references in 2 modules (+2 in tests) (+8 in comments, not counted)
  cohort-analysis                1×  lib/tick-harness/cohort-analysis.ts:194
  market-analysis                1×  lib/tick-harness/market-analysis.ts:201

ALSO TOUCHED BY — processors that do not declare it as a read
  8/9              treasury

SHARED — 52 references across 7 modules:
  goods, treasury, market-pricing, market-comparison-panel, market-table, market-comparison, market-entry
```

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `FOUNDING_STOCK_COVER` | "Cycles of the seed population's RAW consumption that a landed colony's founding endowment aims at… denominated in cycles of demand, the warehouse-policy shape, deliberately not against the price anchor" | The staging target, same denomination | Yes |
| `basePrice` | "Good catalog data (basePrice, floor/ceiling) lives in code constants" — the anchor every price curve multiplies | Procurement price for founding goods, on an S-normalised quantity | Extension of the authored anchor role; the live-price seam exists precisely because catalog ≠ local price |
| `ECONOMY_SCALE` | `lib/constants/treasury.ts:2-5`: treasury values "are ECONOMY_SCALE-invariant by construction" — money never rides S | The divisor that takes an S-scaled quantity into S-invariant money | Yes — this is the authored convention, matching production tax and logistics-work accrual |
| `REFERENCE_VALUE` | "Fixed per-good assessed values for the production tax (a cadastral tax). Value-added-aware… NET of its inputs' base prices" | **Not used** | Correctly rejected — a tax assessment is not a purchase price; using it would price processed goods below their inputs |
| `WorldTreasurySettlement.maintenanceBill` | The cycle's maintenance bill — a standing charge on the faction's building stock | The charter's scale base: a proxy for how much faction there is | Yes, and chosen over the alternatives on purpose. `paid.*` would make broke factions cheap to expand (bills and paid diverge exactly for the broke). The construction bill is largely the founding burst itself, so it would feed back on the thing it is meant to price. No total-bill field exists anyway; three bill fields persist and summing them is trivial, but the sum is the composition this design rejects |
| `COLONY_ESTABLISH_WORK` | "…A temporary construction stand-in until a treasury prices expansion" | Unchanged physical work cost, with the promised treasury pricing now landing beside it | Yes — the docstring's own forward reference, fulfilled (docstring updated at implementation) |
| `CONSTRUCTION_RATE_PER_WORK` | "Money per construction point actually absorbed by the queue" | Unchanged | Yes |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | **Two directions, opposite answers.** (a) *Cost side — immune:* anchor-shift events do not move founding costs while the seam reads `basePrice`; founding prices are event-proof until the live-price upgrade, a deliberate v1 simplification. (b) *Supply side — newly and substantially exposed:* `donorReserve` is scaled by `anchorMult` (`lib/tick/processors/good-market-state.ts:169-172`), so an anchor-shift event at the founder throttles `surplusDrawable` for every cycle of a ~17-cycle establish, where today it could only touch the single completion draw — roughly 17× the exposure window. **Event-driven founding pauses are accepted as desired flavour**: this is precisely pacing emerging from real costs rather than an authored rate, and the achievable-want rule means an event slows a founding rather than deadlocking it. The harness gains a stall-attribution metric so the magnitude is visible rather than assumed | — |
| Population + migration | Seed transfer and job-aware migration untouched; a *paused* project delays the seed's departure, which only ever helps the source. Migration reads nothing new. **But the settler gate does change**: `hungry` counts developed systems below housing cap only, and a forming colony is `controlled` and invisible (`lib/engine/directed-build.ts:1154-1163`), so lengthening the forming window would silently admit more concurrent foundings. In-flight `colony_establish` projects therefore count toward `hungry`, one each, making the gate's strength invariant to establish duration | — |
| Unrest / regime | Indirect only, and in **both** directions: staging draws are **gentler per draw** (the same `surplusDrawable` cap, spread over ~17 cycles instead of one) but **larger in total** (≈1.7× toward the full want). No new unrest input; the founder-stock trajectory is the channel, and it is on the acceptance bar | — |
| Industry + staffing | None — no new buildings, no staffing change. The construction pool path is reused unchanged | — |
| Infrastructure decay | **(i) Staged goods:** they sit in the project ledger, not a market row, so market decay does not eat them — accepted in-transit treatment (see the staging section); granted housing decays as any housing does today. **(ii) The founder side, which is the half that moves:** the founder's stock trajectory changes from one transient dip to a sustained multi-cycle draw across ~800 founder markets. Founder stock feeds `sellingFactor` (the production brake) and the disuse-decay signal, so the expected direction is a *lifted* sellingFactor — slightly more production, slightly less disuse decay — at a galaxy-visible number of markets. A founder-cohort production/decay read joins the A/B | — |
| Directed logistics | Staging draws respect `surplusDrawable` (same cap per draw as today's manifest); v1 stages source-local exactly as today's manifest does (no ships) — the hauling-founding-freight hook is the logistics-depth pass's, noted there. Staged goods are out of logistics' view in both markets until delivery | — |
| Directed build / planner | The core surface: the affordability gate runs **inside** `planFactionColonyProposals` per candidate against a per-faction running budget; charter debit and queue persistence are atomic; `charterPaid` rows are exempt from the persist-if-funded drop; per-cycle staging gates work through `capFor`; two new plumbing channels — `treasuryByFaction: ReadonlyMap<string, {balance, pendingFounding, maintenanceBill}>` built in `runWorldTick`, and a `foundingDebitsByFaction` result channel threaded to the treasury processor exactly as `workPerformedByFaction` is | — |
| Colonisation + founding manifest | The core surface: manifest becomes staged; opening endowment = staging ledger at completion, delivered credit-only; target and per-draw caps unchanged | — |
| Construction orders (player) | `orderColony` gains the `insufficient_funds` check at the mutation boundary; `cancelOrder` gains the staged-goods return rule | — |
| Treasury / purse | `pendingFounding` accumulator + a `foundingExpense` settlement field; the processor's early-return guard and mid-cycle branch gain the founding term; debits land before `settleLadder`, so founding outranks the ladder by design. Ladder, bands, sliders and income are otherwise untouched. Both settlement readers (treasury card `LedgerRow`, `services/treasury` `net`) are updated in this change | — |
| Factions + relations | None — founding is same-faction end to end; no relation reads or writes. Staging writes no flow rows, and same-faction flows are skipped by trade-volume reads anyway | — |
| Save format (`World` shape) | Four new fields across three types, JSON-serializable scalars only; `SAVE_FORMAT_VERSION` bumped; old saves fail cleanly (no defaulting path exists — `lib/world/save.ts:78-83`); new project fields required so `tsc` enforces both creation sites | — |
| The harness's own metrics | `instrumentation.foundingManifests` becomes per-staging-event. The recorder cannot stay as it is: `recordFoundingManifest` early-returns for systems not yet in the founded-colony tracker, and every staging event fires while the target is still `controlled`, so it would silently drop every draw but the last. It gains a **staging accumulator keyed by target system, independent of `foundedColonies`**, folded into the record when the colony is first tracked. Per-draw cover is computed **at emission**, not reconstructed post-tick — post-tick reconstruction cannot attribute two colonies drawing from one founder in one cycle. `founderCoverAfter` is redefined as the **minimum across staging draws**; `foundingStock` gains the money cost per colony. A/B reads must not compare old and new `founderCoverAfter` | — |

### 4. Claims about current behaviour

All measured in the row-10 baseline (`docs/build-plans/colonisation-economics.md`), raw rows there.

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| No code path debits a treasury on founding | 2 writers of `balance`: `treasury.ts:148`, `gen.ts:209`; neither reachable from founding | code sweep + settlement cross-check at both horizons | all 20 factions |
| Founding-era treasuries hold ~9.35× cycles of spend, median funding 1.000 all bands | C3 raw rows | startup + equilibrium (10k, 12k) | 20-faction roster, per cycle |
| The founding-era tail: 16 of 820 faction-cycles (1.95%) shorted **some** band; construction is the band identified at the single 0.070 minimum (t=120) | C3 raw rows — the 16/820 count is any-band, not construction-specific | startup | 20-faction roster, per cycle |
| Founding-era per-cycle maintenance bill is 1,831.1 roster-wide ⇒ ≈91.6 per faction, against per-faction total spend ≈598 and median balance 5,592 | C3 raw rows (band figures are roster totals, median across cycles; the roster/per-faction split is the diag's own `→ per faction` division) | startup | 20-faction roster, per cycle |
| Founding is a startup burst: 57.7% by t=1,000, last founding t=3,696, zero after | C1 raw rows | one deterministic 12k run, checkpoints reproduce both harness horizons | all 562 in-run foundings |
| At the founding tick, the founder's binding-good cover after a one-shot manifest reads 0.29–0.31× (stock ÷ `donorReserve`, minimum across the manifest) | C4 raw rows | 10k + 12k | 806–809 founder markets |
| Separately and in a different unit, founder markets sit at 1.00–1.01× their own good+role cohort norm (stock ÷ `targetStock`, median across markets) — no lasting depression | C4 raw rows (startup ratio near-tautological — 49% self-comparison; equilibrium is the licensed read) | 10k + 12k | 806–809 founder markets vs own good×role cohort |
| The founder supplies only ~45–60% of the uncapped want today: mean manifest 112–145 t/colony against an uncapped want of ≈244 t at S=100 | C4 raw rows + `FOUNDING_STOCK_COVER` × `colonyDemandRate` at the shipped seed | startup + 10k | 562 in-run colonies |
| Chronic struck share of in-run colonies ~3% (leech-colony motivation falsified); but 48% of the colony cohort sits in the rationing regime and 385 of 562 opened deprived | C5 raw rows, 10-cycle trailing window | startup + 10k + 12k | 562 in-run colonies vs 20 homeworlds |
| The haul budget never binds | Funding-bound events 0 at both horizons (count, not share) | both | whole-run logistics |

**Derived (arithmetic on the above, not a separate measurement): the charter dominates the
materials.** At the shipped seed, the S-normalised material bill is ≈115 per colony against today's
realised 145 t/colony draw, and ≈195 against the uncapped want the gate projects. The charter
anchors at ≈595. The materials are the *smaller* monetary cost by roughly 3–5:1, and the harness
gates both magnitudes at calibration.

### 5. Signals and primitives the design consumes

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| Per-cycle work absorption per project | `fundQueueWithFloor` → `workDone`/`workTotal`, `lib/tick/processors/directed-build.ts:359-372` | Monotonic 0→workTotal; **one scalar cap for every project**, scalar total returned, no market or treasury access (`lib/engine/construction.ts:152-195`) | **Does not exist as needed** — a per-project cap is new: an optional `capFor?: (p) => number` (existing scalar when omitted). Absorbed-per-project is recovered by diffing `workDone` by id, as `nextCycleGains` already does |
| A market-write path from the directed-build processor | — | **None** — `DirectedBuildWorld` (`lib/tick/world/directed-build-world.ts:76-95`) exposes no market write | **Does not exist** — `applyFoundingStagingDraws` (per-cycle source debit, clamped at debit time) and a credit-only completion delivery after `addMarketsForSettledSystems` (`lib/world/tick.ts:1096-1097`) are both new |
| A treasury seam in the directed-build processor | — | **None** — its only money input is the flattened `funded.construction` map (`lib/tick/processors/directed-build.ts:74`, wired `lib/world/tick.ts:1084-1085`) | **Does not exist** — `treasuryByFaction` in, `foundingDebitsByFaction` out, both threaded as `workPerformedByFaction` already is |
| Manifest planning with per-cycle running balance | `planFoundingStock`, `lib/tick/processors/directed-build.ts:96-121` | Already per-cycle-shaped: running stock balance per (source, good), `surplusDrawable`-capped | Reused as the staging draw. Its per-faction money analogue (`balance − pendingFounding`) is the same pattern applied to the treasury |
| Faction settlement fields | `lib/tick/processors/treasury.ts:35+`, persisted `WorldTreasurySettlement` (`lib/world/types.ts:339-346`) | Per-cycle, per-faction; `maintenanceBill`, `logisticsBill`, `constructionBill` and `paid: TreasuryBands` all persist | `lastSettlement.maintenanceBill` is directly readable at proposal time — verified, no summing or new field needed for the charter base |
| `pendingWork` accumulator pattern | `WorldFactionTreasury.pendingWork` (`lib/world/types.ts:359`) | Written by directed build / logistics on their own cycle, billed and cleared at settlement | `pendingFounding: number` copies the shape exactly, including the processor guards that must see it |
| `ECONOMY_SCALE` | `lib/constants/economy-scale.ts:30` (env-resolved, server-only) | S=100 live, S=1 pinned in every unit test (`vitest.config.ts:29`) | The valuation seam divides quantities by it. **The S=1 test pin means a missing divisor is invisible to the entire unit suite** — the S-invariance check is on the acceptance bar for that reason |
| `basePrice` per good | `lib/constants/goods.ts` (catalog) | 25–180 across tiers, every good has one, all positive | Non-zero for every stageable good |
| Colony sizing shared AI/player | `sizeColonyEstablish`, `lib/engine/directed-build.ts:1055-1073`; service `lib/services/colony-eligibility.ts:45` | One shared path, both callers | Charter + material projection + `insufficient_funds` added in the shared path so both callers price identically |
| Per-candidate proposal emission | `planFactionColonyProposals`, `lib/engine/directed-build.ts:1081-1086` | "There is NO per-cycle cap" — every eligible candidate is emitted | The running-budget gate is added here, after `sizeColonyEstablish` + source lookup, beside the existing gates |

### 6. Metrics this design targets, and what else moves them

| Metric | Read at which cohort | What else moves it |
|---|---|---|
| Founding cadence (count, timing buckets) | in-run foundings, per-1000-tick buckets (the C1 instrument) | Settler gate (now counts in-flight, deliberately), claim rate, habitable supply; **and the debits' own throttle** — founding money taken before `settleLadder` lowers `funded.construction`, which shrinks the pool, which slows every build. Cadence alone cannot separate "the gate refused" from "the pool got smaller"; the commitment-to-completion metric below does |
| Cycles from commitment to completion | per colony, founding era and equilibrium separately | Pool size and per-project absorption cap. This is the metric that isolates the staging gate from the money gate: the gate changes *how many* start, staging changes *how long* they take |
| Treasury balance + funded-fraction **distribution** (not just median) | 20-faction roster, per cycle, founding era AND equilibrium separately | Tax stance, building stock growth; the known founding-era tail (16/820 any-band, min construction 0.070 at t=120) already shorts before the first founding at t=432, so the pre-t=400 window is excluded from the bar rather than blamed on the charter |
| Maintenance funded fraction, distribution | 20-faction roster, per cycle, founding era | Directly and deliberately: founding is debited before the ladder, so it can push maintenance below its floor's intent. This is the price of that choice and must be read, not assumed small |
| Mean manifest tonnage per colony; founder `surplusDrawable`-suppressed cycle share | per colony / per founder market, founding era | Expected to **rise** (the aggregate-draw effect). Founder stock regrowth rate moves it, so read the suppressed-cycle share alongside — tonnage alone cannot say whether the founder was squeezed or merely richer |
| `founderCoverAfter` (redefined: min across staging draws) | per-colony, min across staging draws | **Unit change** — not comparable across this change; baseline restarts |
| Colony strike% **split by pop cohort**, plus rationing share and opened-deprived | in-run colony cohort, trailing window | Strike% varies ~50-fold across pop cohorts (0.3% at pop ≥1K vs 14.7% at pop 10–100) and this design changes exactly that mix by changing how many colonies exist and how well-stocked they open. The galaxy-wide 3% is uninterpretable on its own; rationing share (48%) and opened-deprived (385/562) are the endowment-responsive numbers |
| Colonies founded at all (the coarse health bar) | whole run, both horizons | A too-strong gate or charter can freeze founding galaxy-wide; the acceptance bar is "burst slows and spreads, does not vanish" |

---

## Acceptance (coarse, per the calibration rule)

Same seed, both horizons, cohorted. Precision tuning is out of scope until Provision and the sibling
cost mechanics land on the same treasury.

**Founding still happens, and paces rather than freezes.** Colonies are still founded and the galaxy
still saturates; the burst spreads, with a measurably later 80% mark than today's t≈1,500. Cadence
is read alongside cycles-from-commitment-to-completion, so a slowdown is attributed to the gate or
to the shrunken construction pool rather than assumed.

**The money bars are founding-era bars.** Cumulative founding spend as a share of founding-era
faction income, and a flattening of the balance trajectory that currently runs 587 → 12,026 across
the era. **The equilibrium hoard is explicitly not a bar**: a one-time founding-era sink is ~1% of
an equilibrium balance and cannot move a 487–759× multiple. Recurring sinks are the sibling
mechanics' to build; claiming this row addresses hoarding would be false.

**Funding does not collapse, measured at the tail rather than the median.** The median funding
fraction reads 1.000 today and would keep reading 1.000 while the shorted tail tripled, so the bars
are: shorted faction-cycle share ≤5% of founding-era faction-cycles (1.95% today), and minimum
`funded.construction` ≥0.5 over t>400. The startup tail is defined as **t ≤ 400** — its last event
is t=120, before the first founding at t=432 — and is excluded from both bars rather than used as
an unbounded excuse.

**Maintenance survives being outranked.** The distribution of `funded.maintenance` across
founding-era faction-cycles, not its median: founding debits land before `settleLadder` by design,
and this is the bar that says whether that choice starved the floor.

**Colonies open at or above today's endowment.** The staging target is unchanged and the aggregate
draw rises, so a *worse* endowment is a bug, not a tradeoff. The endowment-responsive reads are
opened-deprived count (385/562 today) and colony rationing share (48% today); strike% is read split
by pop cohort, never galaxy-wide. The calibration question this row actually asks is the **founder's**
cost: mean manifest tonnage per colony and the founder `surplusDrawable`-suppressed cycle share,
plus a founder-cohort production and disuse-decay read for the `sellingFactor` side.

**Conservation and accounting hold exactly.** These are pass/fail, not calibration:

- Σ charter debits over a run == the number of colonies that ever reached `charterPaid`.
- Σ charters committed by one faction in one cycle ≤ that faction's opening balance.
- Total founder stock is unchanged across order → stage → cancel.
- Σ (staging debits + charters) == Σ `foundingExpense` across settlements; `net` on the treasury
  service reconciles with the balance delta.
- **S-invariance**: total founding expense per colony is identical at `ECONOMY_SCALE` 1 and 100.
  The unit suite is pinned at S=1, so nothing else in it can catch a missing normalisation.
- **Interval invariance** including a `CONSTRUCTION_INTERVAL ≠ CYCLE_LENGTH` configuration.

**Harness instrumentation this needs.** `foundingExpense` joins `moneyFields` in
`treasury-analysis.ts` (finite, non-negative). `isShorted` readings are reported founding-cycle-
separated, so a shortfall caused by a charter is distinguishable from the ambient startup tail.
Stall-cycles are attributed by cause — awaiting charter, awaiting funds, awaiting materials — with
founder-event-driven material stalls counted separately, since those are accepted flavour rather
than a fault. Concurrent in-flight establish count is reported, so the settler gate's invariance to
establish duration is visible.
