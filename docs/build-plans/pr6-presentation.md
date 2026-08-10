# PR6 — band-reconciliation presentation layer

Working file for the branch's finish line: the surfaces that make the shipped economy legible.
Deleted when PR6 ships, after the Doc fold runs.

## Spec

Functional source is §6 of [economy-band-reconciliation.md](../planned/economy-band-reconciliation.md)
("Presentation contract — the panels speak regimes"), plus the Provision display folded in from the
UI queue. §6 is content contract only; the layout below is the output of the house collaborative
wireframe pass it defers to. No `/spec-review` gate applies — the surface is read-side and UI, and
§6 itself rode the band-reconciliation spec review.

### Settled vocabulary

Three ladders survive because they measure three different things. Nothing shares a word across
them, and nothing shares a visual grammar — the terms are deliberately distinct so each is
greppable.

| Term | Measures | Renders as |
| --- | --- | --- |
| Provisioned | Necessity-weighted share of the civilian basket actually delivered this cycle — a flow, not a stock | Percentage + band track |
| Supplied / Strained / Rationing / Shortage | System band, binning Provisioned at `SUPPLIED_PROVISION` and `RATIONING_PROVISION`, famine punching through | One word chip per panel |
| Supplied / Low reserve / Rationing / Shortage / Glut | Per-good state from cycles of stock cover and the selling factor | Colour + cover figure, no word |
| Met / short / critical | One good's satisfaction against the needs line | Glyphs ✓ ⚠ ▼ |
| Grievance | Gap between Provisioned and the persisted memory — what unrest integrates | Distance between two rules on the track |

Reserve-language belongs to the stock ladder, strain-language to the flow ladder. That is why "Low
reserve" is right per good and "Strained" is right per system, and why "Provisioned" is neither.
The label is `Provisioned` wherever it heads a percentage; the code name stays `provision`.

`Provisioned` is goods only. Tax pressure and crowding are siblings of the goods term in the unrest
floor, not components of Provisioned — which is why no candidate label implying the whole condition
of a population (quality of life, standard of living) was taken: the Stability block visibly shows
two non-goods contributors beside it.

### Settled layout

**Population tab**, top to bottom — who lives here, whether they are angry, then why:

1. **Population** — residents, housing capacity, occupancy bar with an overshoot segment past the
   capacity rule, a crowding chip, and a key naming housed / over capacity / capacity.
2. **Stability** — unrest chip, then one bar per contributor (goods shortfall, tax pressure,
   crowding) over the strike threshold caption.
3. **Provisioned** — band chip, the percentage, a band track carrying a solid rule at today's level
   and a dashed rule at the remembered level with a two-item key, then the existing needs ledger
   directly beneath as its per-good decomposition.

**Overview** — a Provisioned vital tile in the existing ghost slot, marking the remembered level
with a dashed tick on the meter.

**Industry** — `Worked` becomes `Staffed` and carries pure labour; the condition joins the existing
exception sub-row rather than a fourth column, which will not fit at the drawer's 560px. `▲` is the
one new glyph, for the state meaning too much rather than too little.

**Map** — a Provisioned choropleth, stepped at the band edges rather than continuously ramped: a
mature galaxy reads ~92-96% Supplied, so a continuous ramp paints almost everything one colour.

### Out of scope by decision

The market table is not rewritten. It is a leftover from the trading game and belongs to the
trader-hangover audit; a dedicated goods tab supersedes it later.

---

## Build plan

### The finding that shapes the order

Provisioned **cannot be honestly recomputed on the read side**, which is why Task 1 exists and why
this PR is not purely UI.

The tick folds its basket from `{ satisfaction, demanded: consumptionRate(goodId, basis) ×
consumptionMult }` (`lib/tick/processors/economy.ts:210-215`, demand built at
`lib/tick/adapters/memory/economy.ts:115`), and neither the resulting `dissatisfactionBySystem` nor
`supplyStateBySystem` is persisted — both are per-tick signals consumed by the population processor
(`lib/tick/processors/population.ts:63-95`). A read service rebuilding the basket from
`computePopNeeds` would match on a quiet system, because both call the same `consumptionRate`, but
would diverge on any system carrying an event consumption modifier — `consumptionMult` has no
read-side path. Events are precisely the interaction `AGENTS.md` names as the most-forgotten one.

Persisting the two values at the economy cycle removes the divergence by construction and follows
the pattern already set by `satisfaction` (`lib/world/types.ts:270-276`, persisted so "the display
and the sim cannot diverge") and by `provisionExpectation` (`lib/world/types.ts:97`). The cost is
one optional field pair and a save-format addition.

---

### Task 1 — Persist Provisioned and its band on the system

**Files:** `lib/world/types.ts`, `lib/tick/processors/population.ts`,
`lib/tick/world/population-world.ts`, `lib/tick/adapters/memory/population.ts`,
`lib/world/__tests__/save.test.ts`

**Interface:** `StarSystem.provision?: number` and `StarSystem.supplyBand?: SupplyRegime`, written
once per economy cycle from the same `dissatisfactionBySystem` / `supplyStateBySystem` signals the
unrest read already consumes in the same loop. Absent means never assessed — deliberately not
coerced to 0, matching the `provisionExpectation` convention rather than the `collapseDebt` one.
The population world interface gains the write alongside the existing `provisionExpectation` write.

**Proves:**
- A system that has never run an economy cycle reads absent, not zero — the absent-means-assessed-at-famine
  trap the `provisionExpectation` docstring already records.
- The persisted Provisioned is the complement of the dissatisfaction the same cycle handed the
  unrest read, for the same system — not a re-derived mean.
- A survival shortfall persists band Shortage even while Provisioned sits high, so the famine
  punch-through survives persistence rather than being re-inferred from the number.
- A mid-cycle tick leaves both fields untouched; only an economy cycle writes them.
- Both survive a save/load round trip with no `NaN`/`Infinity` reaching `JSON.stringify`.

**Consumes:** nothing.

---

### Task 2 — Provisioned, band, memory and grievance on the per-system reads

**Files:** `lib/services/system-population.ts`, `lib/services/system-vitals.ts`, `lib/types/api.ts`

**Interface:** a shared `SystemProvisionRead { pct: number; band: SupplyRegime; expectationPct:
number; grievance: number } | { assessed: false }` added to both `SystemPopulationData` and
`SystemVitalsData` under their existing `visibility: "visible"` arm. The memory is resolved through
`readExpectation` (`lib/engine/expectation.ts:43`) rather than read raw, and the grievance through
`grievanceShortfall` (`lib/engine/population.ts:287`) — one implementation each, shared with the
tick.

**Proves:**
- A system with no persisted assessment renders the unassessed arm; the panel never shows 0%.
- A corrupt or absent stored expectation seeds from current Provisioned rather than reading as
  perfect memory — the read guard's whole purpose, exercised through the service not the engine.
- Grievance is zero when delivery meets or exceeds memory, at any absolute level, so a world long
  resigned to a low Provisioned reports no grievance.
- A famine system reports band Shortage while its percentage is high.
- An economically inactive system still returns `visibility: "unknown"` with no provision arm.

**Consumes:** Task 1.

---

### Task 3 — Unrest contributors and trend

**Files:** `lib/engine/unrest-readout.ts` (new), `lib/services/system-population.ts`,
`lib/types/api.ts`

**Interface:** `unrestContributors(input): { goods: number; tax: number; crowding: number }` and
`unrestTrend(current, settled): "rising" | "stable" | "recovering"`, both pure. Tax is the owning
faction's `TAX_LEVEL_UNREST_PRESSURE` lookup, crowding is `crowdingPressure`
(`lib/engine/population.ts:401`), goods is `supplyUnrestTerm` (`:311`). The service exposes them
plus `strikeThreshold` on the population read. No new persisted state — the trend compares current
unrest against the settled value it is relaxing toward.

**Proves:**
- The three contributors reproduce the settled unrest the tick's own relaxation targets for the same
  inputs, so the panel cannot show causes that do not sum to the effect.
- Tax reads zero for a system with no owning faction, rather than falling back to a default level.
- Crowding is zero below the crowding onset and never exceeds `CROWDING.PRESSURE_MAX`, so a fully
  overcrowded world still cannot strike on crowding alone.
- Trend reports recovering when the settled target sits below current unrest, and rising when above
  — both arms, not just the one a healthy fixture exercises.
- The trend is computed with no stored history; a fresh world with no prior unrest still reports a
  defined arm.

**Consumes:** Task 2.

---

### Task 4 — Population tab view-model

**Files:** `components/system/provision-view.ts` (new)

**Interface:** pure helpers mirroring the `needs-view.ts` precedent — `bandLabel(band):
string`, `bandTone(band)`, `provisionScaleSegments(): Array<{ band; width }>` derived from
`SUPPLIED_PROVISION` / `RATIONING_PROVISION` so the track cannot drift from the classifier, and
`occupancyBar(population, popCap): { fillPct; overshootPct; crowdChip }`. No DOM, no React — the
unit project has no jsdom, so the logic that deserves tests lives here and the components stay thin.

**Proves:**
- The track's segment widths move when the band constants move, rather than being authored twice.
- An occupancy at exactly capacity produces no overshoot segment; above it produces one sized to the
  excess.
- Occupancy at or past the growth-brake end still renders a bounded bar rather than overflowing.
- A zero or negative capacity produces a defined result rather than dividing by zero.
- The crowding chip's boundaries are the same ones the growth brake uses, not a display-only cut.

**Consumes:** Task 2.

---

### Task 5 — Population tab and Overview tile

**Files:** `components/system/population-panel.tsx`, `components/system/population-summary.tsx`,
`components/ui/contributor-bars.tsx` (new), `components/system/provision-block.tsx` (new),
`app/(game)/@panel/system/[systemId]/page.tsx`

**Interface:** `ContributorBars({ segments, total, threshold? })` in `components/ui/` — a shared
primitive, not inline, because the owner asked for it wherever a number has several contributors
(labour pools, funding categories, per-category treasury spend are the named future callers).
`ProvisionBlock({ read, needs })` composes the band track, the two rules, the key and the existing
needs ledger. The Overview consumes the same read for its tile in the current ghost slot.

**Proves:**
- A `popCap <= 0` system with residents or unrest still renders population, stability and collapse
  state rather than the generic Uninhabited empty state — the §6 collapsed-housing requirement, and
  the current panel's actual behaviour is the opposite (`population-panel.tsx:97`).
- The strike language names Strike at the mechanic's own threshold, so badge and warning cannot
  disagree.
- An unassessed system renders the provision block's absent state without crashing the tab.
- The needs ledger keeps its collapsed met tail and pressure ordering after the move.

**Consumes:** Tasks 3, 4.

---

### Task 6 — Industry: Staffed plus the state sub-row

**Files:** `components/system/needs-view.ts`, `components/system/industry-panel.tsx`

**Interface:** `ProblemItem["kind"]` gains `"staffing"` and `"selling"`; `buildProblems` takes the
building's staffing and selling readings alongside the supply and pop-need arguments it already
takes. No new read-side plumbing — `staffedFraction` is already the pure staffing ratio for
producers and `idleReason` already names the binding constraint
(`lib/engine/industry.ts:544`, `:573-577`), and `UtilizationContext.sellingFactor` (`:401`) is
already the isolated selling accessor §6 asks for.

**Proves:**
- A fully staffed, input-satisfied, freely selling producer yields an empty item list — the vacuity
  check, and the reason the column was rejected.
- A glut item appears only when the producer is fully staffed and input-satisfied, so §1's
  precedence holds and an input-starved factory never reads as glut while its stock drains.
- An understaffed producer names the binding grade rather than a generic labour shortfall.
- An input-short producer still lists every short input, not only the worst.
- Housing rows never produce a selling item.

**Consumes:** nothing.

---

### Task 7 — Provisioned map mode

**Files:** `lib/services/provision-map.ts` (new), `lib/types/game.ts`, `lib/types/map.ts`,
`components/map/pixi/value-ramp.ts`, `components/map/map-overlay-controls.tsx`,
`lib/query/keys.ts`, `lib/hooks/use-provision.ts` (new),
`app/api/game/systems/provision/route.ts` (new)

**Interface:** `ProvisionEntry { systemId: string; provision: number; band: SupplyRegime }` and
`getProvisionBySystem(): ProvisionEntry[]`, mirroring `getStabilityBySystem`. `MapMode` and
`ValueMode` gain `"provision"`; `isValueMapMode` includes it. The ramp is stepped: the legend
gradient renders from the same stops the Pixi layer fills from, as the four existing modes already
do.

**Proves:**
- Two systems inside one band render the same colour; two either side of a band edge render
  different colours — the stepped property, which a continuous ramp would silently satisfy nowhere.
- An unassessed system renders absent rather than the bottom of the ramp, so undeveloped space does
  not read as famine.
- `isValueMapMode` returning true for the new mode is what gives it faction-scoped zoomed-out
  interaction; a mode added to `MAP_MODES` alone loses it silently.
- `isMapMode` narrows the new value, so a sessionStorage-hydrated selection survives a reload.

**Consumes:** Task 1.

---

### Gate — `RATION_EXIT_EPS`

**Arms:** none — this is a calibration read, not an A/B.

**Reads:** the distribution of Provisioned across the galaxy at both horizons, cohorted, with
attention to how many systems sit within a candidate epsilon of `SUPPLIED_PROVISION` and
`RATIONING_PROVISION` on consecutive cycles. The constant's job is to stop a system parked at an
edge flapping its band chip and, later, spamming the alert feed.

**Merge condition:** a value chosen from the measured edge population rather than authored blind,
and the scope decision below recorded.

**Scope decision owed at this gate.** §7 authored `RATION_EXIT_EPS` as hysteresis for the per-good
regime chips. Those chips no longer exist as chips — the market table is dropped and per-good state
renders as a cover figure — so the only surfaces that can flap are the system band chip and the
Industry glut item. The constant should attach to the system band edges. This is a scope narrowing
that follows from an owner decision, not a mechanism change, but it retargets a spec-authored
constant and so is named here rather than assumed.

---

### Task 8 — Doc fold

**Files:** as enumerated under Doc fold below — two `docs/planned/` promotions, one deletion, and
the active-doc corrections.

**Interface:** none — this task exposes no contract. It is in the order because it is the largest
piece of writing in the PR and the branch convention puts it before the final review, not after.

**Proves:** not a code task, so the detection list is replaced by the fold's own checks: every
`docs/planned/` doc named here is either promoted or deleted with its deferrals booked; no promoted
doc keeps a present-tense claim contradicted by `lib/`; each roadmap-alleged stale active doc is
verified against code before editing rather than trusted.

**Consumes:** Tasks 1-7 — the fold documents what they shipped, so it runs after them.

---

## Verification

- `npm run simulate`, **both horizons**, cohorted. The presentation layer changes no gameplay, so
  the passing bar is that the economy metrics are unmoved from the pre-branch baseline — a moved
  metric means Task 1's persistence leaked into behaviour rather than recording it.
- One new harness read for the gate: the Provisioned distribution against the two band edges, at
  both horizons. Without it the edge population hides inside the existing median and the constant
  gets authored blind.
- `npx next build --webpack` — the build gate. Load-bearing here: this PR adds prose-heavy docs and
  touches `globals.css`-adjacent surfaces, and the Tailwind scan trap only surfaces on a real build.
- `npx vitest run` and `tsc` clean; the red-proof gate run item by item against each task's
  detection list.
- Manual visual smoke on a live world across all six surfaces, including a `popCap <= 0` system and
  an unassessed one — wait for the owner's go-ahead rather than self-certifying.

## Doc fold

Owner decision: the whole fold — PR6's own and the branch's accumulated debt — lands in this PR, on
this branch, before the final review. It is a task in the order (Task 8), not a closing chore, because
it is the largest single piece of writing here and doing it last is how it gets skipped.

**Promote and delete** — two planned docs whose features shipped and which now describe live
mechanics in the present tense as unbuilt:
- `docs/planned/necessity-weighted-unrest.md` (448 lines) — its headline "every good … currently
  hits unrest with the same instrument" is false; `GOOD_NECESSITY` and `slopeShortage` are live.
- `docs/planned/economy-rationing-amendment.md` (89 lines) — `RATION_COVER` is live.
- `docs/planned/economy-band-reconciliation.md` — deleted at the same point, its §6 having become
  this feature.

**Correct in place** — active docs the arc made stale:
- `docs/active/gameplay/economy.md:117` — still documents unrest decay as a continuous proportional
  shave (`count ← count − unrestRate · count · …`) when what shipped is whole-level teardown driven
  by the `collapseDebt` accumulator. Its band section (`:256`) is already correct; the rest needs
  reading rather than assuming.
- `docs/active/gameplay/colonisation.md`, `docs/active/engineering/tick-engine.md`,
  `docs/active/gameplay/economy-autonomic-agency.md` — named stale by the roadmap row. Verify each
  against code before editing; the roadmap's claim is a lead, not evidence.
- `docs/SPEC.md` — the presentation contract and the persisted Provisioned/band fields.
- `docs/active/design-system/theme.md` — the `ContributorBars` primitive and the `▲` glyph.

**Before deleting any doc, book what it defers** — grep each for deferred/follow-up work and confirm
each was actually booked, per `AGENTS.md`.

This working file is deleted at ship.

## Not covered

- **Market table rewrite** — *dropped*, by owner decision: it is a trading-game leftover, and
  cycles-of-cover as a primary unit needs fields `MarketEntry` does not carry
  (`lib/types/game.ts:168-176`). Superseded by the goods tab below.
- **Dedicated goods tab** — *booked*: a roadmap row added on this branch, a goods surface with more
  depth than Population or Industry, replacing what the market tab was for.
- **Per-good regime chips as words** — *dropped*: three ladders sharing the words Supplied and
  Rationing across different inputs was the pass's central legibility finding; per-good state renders
  as colour plus a cover figure instead. The classifier still exists for the Industry glut item.
- **Extractor glut in the deposit table** — *booked at the gate*: the deposit table already runs five
  columns and spawns sub-rows for shared resources, so a sub-row under a sub-row may not read.
  Checked against a real system at the manual smoke; if it does not read, the state rides the
  existing row tooltip and that is recorded there.
- **Alert feed on band transitions** — *booked*: roadmap row 8 (player-seat slice 4) owns it. The
  hysteresis this plan calibrates is what makes those transitions alert-worthy.
- **Nested/pinnable deep tooltips** — *booked*: an existing roadmap row. The Provisioned tooltip
  ships flat, carrying §6's "weighted by how badly it needs it" wording.
- **Game-term glossary** — *booked*: an existing roadmap row that already names Provision. This plan
  settles the vocabulary; the glossary is where it gets defined once.
- **`PopNeedData.pressure` docstring** — *dropped* as a separate item because it is fixed in place:
  it describes the retired squared fold (`lib/types/api.ts:164`) while the shipped fold is linear,
  and Task 2 edits that file.
