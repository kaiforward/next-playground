# Colonisation economics — founding stops being free

**Founding a colony becomes a priced strategic decision.** Committing to a colony costs money once
(a charter), and building it costs money, materials and construction work continuously until it
opens — all drawn from the same treasury, warehouses and construction pool as everything else the
faction wants to do. Pacing emerges from those costs competing: nothing authors a founding rate.
The AI founding policy weighs the full price against its treasury before proposing, so a poor
faction stops expanding on its own, and a founding in progress can stall and resume when the money
or the materials run short.

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
   funding (the moment it becomes real — autonomic proposals that never fund never pay). Scaled to
   the faction's own economy: a multiple of its last settlement's total bill, floored by a constant
   so a pre-settlement faction still pays something. This is the felt decision moment — the
   Stellaris-outpost beat — and the knob that stays independent of everything later mechanics
   re-price.

2. **Materials — staged per cycle, paid at reference prices.** The founding manifest stops being a
   one-shot raid at completion. Each cycle the project absorbs work, a matching share of the
   manifest is staged: drawn from the founder's warehouses under the same `surplusDrawable` caps as
   today, and **paid for** — the treasury is debited `quantity × basePrice` per good as it stages.
   Construction cannot outrun materials: a cycle's work absorption is capped by the manifest share
   staged, so ships, temporary surface infrastructure and the seed housing are physically fed as
   they are built. The staged goods are the colony's opening endowment — the target is unchanged
   (`FOUNDING_STOCK_COVER` = 30 cycles of the seed's raw consumption).

3. **Establish work — unchanged.** Still 68 points from the shared per-faction pool, ROI-ordered
   against ordinary builds, billed generically through the construction band. Deliberately kept
   generic: the colony-specific money is the charter and the materials; the band stays one bill.

Money leaves the world at both new debit sites (there is no counterparty) — the first deliberate
money sinks. Welcome ones: equilibrium treasuries currently hoard 487–759× cycles of spend, and
"no runaway hoards" is the treasury's own calibration bar.

### The decision side — the AI prices colonies against its treasury

Gate-first, per the `Proposal`/ROI rubric (enablers raise cost or gate eligibility, never value): a
faction only *proposes* a colony while its balance covers the charter plus a headroom multiple of
the projected material bill (computable at proposal time: manifest want × `basePrice`). The ROI
value axis and `work` denominator are untouched — money does not enter the value scalar, so no
invented money→output exchange rate. A rich faction sequences colonies against its other spending;
a broke one proposes none until it recovers. The existing physical gates (settler supply,
habitable floor, claim rate) all stand beneath this.

The player's direct colony verb pays the same prices — `colony-eligibility` (the shared sizing
service) grows the charter and projected material bill so the UI can show the full price before
commitment.

### Stall and resume

A founding in progress pauses — absorbs no work, stages no materials — in any cycle where the
treasury cannot pay for the next staging share or the founder cannot spare the goods. It persists
and resumes when conditions recover; nothing is refunded, nothing is destroyed. Pause-and-resume is
chosen over abandon/degrade as the least destructive and most legible rule; a stalled founding is
also a natural future event hook (not built here).

### The valuation seam

One function values goods for founding — charter projection and staging debits both go through it.
Today it reads the catalog `basePrice` (`lib/constants/goods.ts`); when the goods-pricing revisit
ships, it swaps to live local market prices with no redesign (Kai's constraint, 2026-08-05: live
prices misbehave today — producers/consumers not reading price by type properly; see the
goods-pricing roadmap row). It deliberately does **not** read `REFERENCE_VALUE`
(`lib/constants/treasury.ts:95`): that table is a cadastral *tax assessment*, value-added net of
inputs — as a procurement price it would price alloys below their inputs' sum. Different authored
meaning, wrong table.

## What deliberately does not change

- **Claims stay free and rate-capped.** A claim is a territorial intention (map paint); the priced
  act is committing to establish. Pricing claims would slow paint without adding decision weight.
  Flagged for spec review as an explicit call.
- **The seed stays 2 pops, and seed-vs-housing-unit stays parked.** Staging changes founding's cost,
  not its size; un-parking the seed item would compound two pacing changes in one measurement.
  It un-parks, deliberately, only after this ships and is measured.
- **Band billing stays generic** (see stream 3). The construction band's bill is one number; the
  colony's work inside it is indistinguishable from a factory's, by design.
- **No debt.** `balance` never goes negative; a purchase that cannot be paid does not happen
  (that is the stall rule).

## New and changed constants

All coarse first-cut, harness-calibrated, values-stay-coarse until priced logistics / military /
industry pricing land on the same treasury (per the standing calibration rule). In
`lib/constants/colonisation.ts`:

| Constant | Meaning | First-cut anchor |
|---|---|---|
| `CHARTER_FEE_SPEND_MULT` | Charter = mult × the faction's last settlement total bill | ~1.0 — one cycle of spend, the measured bite point (founding-era spend ≈ 600/cycle vs ≈ 5,600 balance) |
| `CHARTER_FEE_MIN` | Floor when no settlement has happened yet | small; > 0 |
| `FOUNDING_GATE_HEADROOM` | Propose only while balance ≥ charter + headroom × projected material bill | ~1.0 |
| `FOUNDING_STOCK_COVER` (existing) | Unchanged meaning — cycles of seed raw consumption; now a **staging target** instead of a completion-time draw | 30, unchanged |

Docstring debt paid alongside: `COLONY_ESTABLISH_WORK`'s docstring calls itself "a temporary
construction stand-in until a treasury prices expansion" — this spec is that pricing; and both
colonisation/expansion constants files cite `docs/planned/economy-colonisation-cost.md`, which no
longer exists. Both docstrings get re-pointed at implementation.

## Save format

`WorldColonyEstablishProject` gains the staging ledger (`stagedManifest`: per-good quantities
staged so far) and `charterPaid`. `WorldTreasurySettlement` gains a founding expense line (charter +
staging debits that cycle) so the purse UI and the harness can attribute the drain. Save-format
bump; `deserialize` treats missing fields as zero/false (an old save's in-flight colonies were
committed under the free model and complete under it — acceptable one-time grandfathering, noted
for review).

---

## Design-hazards worksheet

### 1. One quantity, several unrelated jobs

| Quantity | Every reader today (`file:line`) | Which this design moves | Intended? |
|---|---|---|---|
| `FOUNDING_STOCK_COVER` | def `lib/constants/colonisation.ts:64`; sole reader `lib/tick/processors/directed-build.ts:111` (`want = COVER × colonyDemandRate`) | The one reader: want becomes a staging target, drawn over cycles instead of at completion | Yes — same quantity, same meaning, different delivery schedule |
| `surplusDrawable` | def `lib/engine/directed-logistics.ts:87`; logistics donor matcher `:243`; build input-supply gate `lib/engine/directed-build.ts:702`; founding manifest cap `lib/tick/processors/directed-build.ts:114` | None — staging keeps the same cap per draw | **Deliberately kept coupled** (it is the known unresolved triple-duty from the hazard list): a founder's willingness to part with stock stays consistent with what logistics may draw from it. Separating it is the goods-pricing revisit's problem, not this spec's |
| `basePrice` | catalog `lib/constants/goods.ts`; price curve floor/ceiling/anchor `lib/engine/market-pricing.ts:28-33`; `REFERENCE_VALUE` derivation `lib/constants/treasury.ts:84-88` | **Adds a fourth reader**: the founding valuation seam | Yes, deliberate — procurement at catalog price, behind one seam. The tax table is explicitly NOT reused (hazard 2) |
| `COLONY_ESTABLISH_WORK` | def `lib/constants/colonisation.ts:15`; tick params `lib/world/tick.ts:1073`; player verb sizing `lib/services/colony-eligibility.ts:45` (impact verdict: SHARED, 3 modules) | Value unchanged; the player-verb service gains charter + material projection alongside it | Yes — the coupling is the point: AI and player must price identical projects. The service is the single shared sizing path for both |
| `WorldFactionTreasury.balance` | writers: settlement `lib/tick/processors/treasury.ts:148`, world-gen init `lib/world/gen.ts:209` (measured — the full impact output is in the evidence file) | **Adds two debit sites**: charter at first funding; staging purchases per cycle | Yes. Both go through `safeMoney`, both respect balance-never-negative (can't pay → stall, never debt) |
| `CONSTRUCTION_RATE_PER_WORK` | `lib/constants/treasury.ts:26` → construction bill `lib/tick/processors/treasury.ts:120-124` | None | Establish work keeps billing exactly as today |

### 2. A constant read for a meaning it was not authored to have

| Constant | Docstring says | This design uses it as | Same thing? |
|---|---|---|---|
| `FOUNDING_STOCK_COVER` | "Cycles of the seed population's RAW consumption that a landed colony's founding endowment aims at… denominated in cycles of demand, the warehouse-policy shape, deliberately not against the price anchor" | The staging target, same denomination | Yes |
| `basePrice` | "Good catalog data (basePrice, floor/ceiling) lives in code constants" — the anchor every price curve multiplies | Procurement price for founding goods | Extension of the authored anchor role; the live-price seam exists precisely because catalog ≠ local price |
| `REFERENCE_VALUE` | "Fixed per-good assessed values for the production tax (a cadastral tax). Value-added-aware… NET of its inputs' base prices" | **Not used** | Correctly rejected — a tax assessment is not a purchase price; using it would price processed goods below their inputs |
| `COLONY_ESTABLISH_WORK` | "…A temporary construction stand-in until a treasury prices expansion" | Unchanged physical work cost, with the promised treasury pricing now landing beside it | Yes — the docstring's own forward reference, fulfilled (docstring updated at implementation) |
| `CONSTRUCTION_RATE_PER_WORK` | "Money per construction point actually absorbed by the queue" | Unchanged | Yes |

### 3. A system you did not think about

| System | Interaction | Reason if none |
|---|---|---|
| Events | None built, two touchpoints noted: (a) anchor-shift events do NOT move founding costs while the seam reads `basePrice` — founding is immune to price events until the live-price upgrade, a deliberate v1 simplification; (b) a stalled founding is a natural future event surface (booked as a note, not a mechanic) | — |
| Population + migration | Seed transfer and job-aware migration untouched; a *paused* project delays the seed's departure, which only ever helps the source. Migration reads nothing new | — |
| Unrest / regime | Indirect only: staging draws reduce founder stock gradually instead of one-shot — strictly gentler on the founder's supply state than today (measured today: transient 0.29× dip, no lasting mark). No new unrest input | — |
| Industry + staffing | None — no new buildings, no staffing change. The construction pool path is reused unchanged | — |
| Infrastructure decay | None — staged goods sit in the project ledger, not in a market row, so market decay does not eat them; granted housing decays as any housing does today | Ledger-vs-market is a review question: if review prefers staged goods to decay, they move to a market row at the colony site instead |
| Directed logistics | Staging draws respect `surplusDrawable` (same cap as today's manifest); v1 stages source-local exactly as today's manifest does (no ships) — the hauling-founding-freight hook is the logistics-depth pass's, noted there | — |
| Directed build / planner | The core surface: affordability gate ahead of `planFactionColonyProposals`; per-cycle staging coupled to work absorption in the processor; persist-if-funded semantics unchanged (a funded-then-stalled colony has `workDone > 0` and persists) | — |
| Colonisation + founding manifest | The core surface: manifest becomes staged; opening endowment = staging ledger at completion; target and caps unchanged | — |
| Treasury / purse | Two new debit sites + one new settlement expense line; ladder, bands, sliders, income untouched. Sinks reduce equilibrium hoards (measured 487–759× cycles — the direction the calibration bar wants) | — |
| Factions + relations | None — founding is same-faction end to end; no relation reads or writes | — |
| Save format (`World` shape) | `WorldColonyEstablishProject` + `WorldTreasurySettlement` fields, JSON-serializable scalars only; bump + grandfathering rule above | — |
| The harness's own metrics | `instrumentation.foundingManifests` becomes per-staging-event; harness sums per colony. `founderCoverAfter` is redefined as the **minimum across staging draws** (the binding moment) — not comparable with the pre-change 0.29–0.31× readings, which the evidence file already warns are their own unit. `foundingStock` gains the money cost per colony. A/B reads across this change must not compare the old and new founderCoverAfter | — |

### 4. Claims about current behaviour

All measured in the row-10 baseline (`docs/build-plans/colonisation-economics.md`), raw rows there.

| Claim | Evidence | Horizon | Cohort |
|---|---|---|---|
| No code path debits a treasury on founding | 2 writers of `balance`: `treasury.ts:148`, `gen.ts:209`; neither reachable from founding | code sweep + settlement cross-check at both horizons | all 20 factions |
| Founding-era treasuries hold ~9.35× cycles of spend, median funding 1.000 all bands; tail: 16/820 faction-cycles short construction (min 0.070 at t=120) | C3 raw rows | startup + equilibrium (10k, 12k) | 20-faction roster, per cycle |
| Founding is a startup burst: 57.7% by t=1,000, last founding t=3,696, zero after | C1 raw rows | one deterministic 12k run, checkpoints reproduce both harness horizons | all 562 in-run foundings |
| The founder's one-shot manifest dip (0.29–0.31×) is transient; founder markets sit at 1.00–1.01× their good+role cohort norm | C4 raw rows | 10k + 12k (startup ratio near-tautological — 49% self-comparison; equilibrium is the licensed read) | 806–809 founder markets vs own good×role cohort |
| Chronic struck share of in-run colonies ~3% (leech-colony motivation falsified) | C5 raw rows, 10-cycle trailing window | startup + 10k + 12k | 562 in-run colonies vs 20 homeworlds |
| The haul budget never binds | Funding-bound events 0 at both horizons (count, not share) | both | whole-run logistics |

Hypothesis (not measured, labelled): staged material purchases at `basePrice` will be the dominant
monetary cost (order thousands per colony against a founding-era balance of ~5,600) — the harness
gates the actual magnitude at calibration.

### 5. Signals and primitives the design consumes

| Consumes | Produced at | Actual shape today | Design assumes |
|---|---|---|---|
| Per-cycle work absorption per project | `fundQueueWithFloor` → `workDone`/`workTotal`, `lib/tick/processors/directed-build.ts:359-372` | Monotonic 0→workTotal, persist-if-funded drops workless autonomic colonies | Same; staging couples to the per-cycle absorbed delta |
| Manifest planning with per-cycle running balance | `planFoundingStock`, `lib/tick/processors/directed-build.ts:96-121` | Already per-cycle-shaped: running stock balance per (source, good), `surplusDrawable`-capped | Reused as the staging draw — the primitive the design needs already exists |
| Faction settlement (bills, paid, funded per band) | `lib/tick/processors/treasury.ts:35+`, persisted `WorldTreasurySettlement` | Per-cycle, per-faction; the C3 diag read it directly from world state | Last settlement's total bill is readable at proposal time for the charter scale — **verify the persisted shape carries total bills at build-plan** |
| `basePrice` per good | `lib/constants/goods.ts` (catalog) | 25–180 across tiers, every good has one | Non-zero for every stageable good |
| Colony sizing shared AI/player | `sizeColonyEstablish`, `lib/engine/directed-build.ts:1055-1073`; service `lib/services/colony-eligibility.ts:45` | One shared path, both callers | Charter + material projection added in the shared path so both callers price identically |

### 6. Metrics this design targets, and what else moves them

| Metric | Read at which cohort | What else moves it |
|---|---|---|
| Founding cadence (count, timing buckets) | in-run foundings, per-1000-tick buckets (the C1 instrument) | Settler gate, claim rate, habitable supply — all unchanged, so a cadence shift is attributable; but galaxy size/seed changes it wholesale — same seed for A/B |
| Treasury balance + funded fractions | 20-faction roster, per cycle, founding era AND equilibrium separately | Tax stance, building stock growth; the known 16/820 startup tail already shorts construction — a worsening there must be split from the charter's own draw |
| `founderCoverAfter` (redefined) | per-colony, min across staging draws | **Unit change** — not comparable across this PR; baseline restarts |
| Colony strike% / opening satisfaction | in-run colony cohort, trailing window | Provision lands after this row and re-defines the fold — calibrate coarse only (the row's Don't) |
| Colonies founded at all (the coarse health bar) | whole run, both horizons | A too-strong gate or charter can freeze founding galaxy-wide; the acceptance bar is "burst slows and spreads, does not vanish" |

---

## Acceptance (coarse, per the calibration rule)

At both horizons, same seed: founding still happens and still saturates eventually, but the burst
spreads (measurably later 80% mark than t≈1,500); treasuries dip visibly at foundings without an
insolvency spiral (median funding stays ~1.0 outside the known startup tail); equilibrium hoard
multiple falls from 487–759×; no colony opens with a materially worse endowment than today's
(staging target unchanged); colony strike% does not regress from ~3%. Precision tuning is
explicitly out of scope until Provision and the sibling cost mechanics land.

## Open questions for spec review

1. Charter debit at first funding (chosen: proposals are re-emitted, only real commitments pay) vs
   at proposal acceptance — is first-funding's one-cycle lag acceptable?
2. Staged goods in the project ledger (chosen: no decay, no logistics visibility) vs in a market row
   at the colony site (decays, visible, raidable-by-future-mechanics)?
3. Claims staying free — Kai to confirm the deliberate call.
4. Work-gated-by-materials coupling: hard cap (chosen) vs soft penalty?
5. The settlement expense line: enough for the purse UI, or does PR6's presentation need per-colony
   attribution?
