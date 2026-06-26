# SP5 Stage 1 — Seed-Coherence Foundation (design)

> **Status: Design (brainstormed 2026-06-26).** First slice of the SP5 seed-coherence re-sequencing.
> Sits **on** substrate-v2 + SP3.5 decay + the unmerged logistics Phase 1 (on `feat/sp5-autonomic-light`,
> reused as the silent engine). Roadmap home: `economy-simulation-vision.md` §13 (2026-06-26 callout) ·
> `negative-space-economy.md` · resume/rationale in `sp5-seed-coherence-resequencing.md`.
> North-star constraints: emergent realism from physical primitives + the negative-space economy.
>
> **Delete this file once Stage 1 ships** — the functional design folds into the active economy specs
> and the code becomes the source of truth. The detailed implementation plan is produced separately
> (writing-plans) once this design is approved.

---

## Headline — the mechanic in one breath

The seeder stops hand-authoring a mature galaxy. Instead it places a few **tier-0 subsistence cores**
per faction and leaves the rest of the map **inert**; a new **build planner** then grows the whole
industrial economy — manufacturing, specialisation, export hubs — by **building supply where logistics
runs out of reachable surplus**; and an **age-forward harness** runs that live agency forward and
snapshots the matured state back as the canonical seed.

> **One allocation authority.** The build planner is the *only* place that decides industrial
> configuration. The seeder calls it once (subsistence, tier-0, local). The harness runs it in a loop.
> Live gameplay runs it every agency cycle. Seed, matured galaxy, and live world are therefore coherent
> by the *same* rules — which is the entire point of the pivot: stop hand-authoring the mature state,
> grow it from rules.

### Why this exists (the pivot, one paragraph)

The recurring "seed bug" pain had one root: the old seeder (`industry-seed.ts allocateIndustry`) is a
*lossy second implementation of faction agency* — it maxes tier-0 extraction to deposit caps and gates
tier-1+ factories on *local* input self-sufficiency, so it over-produces raws, starves manufactured
goods (scarcity tracks recipe depth), and can't place the import-fed specialisation a real faction
builds. A faction wouldn't build assuming imports — it would *know*. So the seeder must either *become*
the agency model (duplication) or stop making agency decisions. Stage 1 chooses the latter.

---

## How it composes with what exists

| Flow | Driver | Effect timing | Reuses |
|---|---|---|---|
| **Market diffusion** (`tradeFlow`) | price gradient | gradual | — |
| **Directed logistics** (Phase 1) | faction need, *moves existing surplus* | cycle-boundary | hop cache, deficit/surplus classify |
| **Build-up** (this slice) | faction need, *creates absent supply* | gradual (count ramps over ticks) | logistics' classify + reachability |
| **Infra decay** (SP3.5) | disuse | per economy shard | — |

Build is the **up-arrow** to decay's down-arrow on `SystemBuilding.count`, and the **supply-side twin**
of the logistics matcher: logistics moves surplus to deficits; build creates supply where no reachable
surplus exists. They compose into a growth loop — build creates a surplus → logistics distributes it →
that reveals the next structural gap → build fills it.

---

## Component 1 — the build-up planner (the core)

A new `factionBuild` processor on the slow agency clock. Per faction per cycle, four steps:

### 1. Structural-deficit signal

Reuse the logistics engine's classification (`directed-logistics.ts` lines 61–77 — extract the shared
helper): a `(system, good)` is a **deficit** when `stock < targetStock × DEFICIT_FRACTION`, a
**surplus** when `stock ≥ targetStock × SURPLUS_MARGIN`. The build signal is the subset of deficits that
are **structural** — a deficit for good `g` at system `s'` for which **no reachable same-faction
surplus of `g` exists** (via the cached `routeCost`). A non-structural deficit (reachable surplus
exists, logistics just hasn't delivered yet) is *not* a build target — logistics owns it.

> Distinguishing "no reachable surplus" (structural → build) from "reachable surplus, budget exhausted"
> (→ leave to logistics) is what stops build from over-building goods the faction already makes enough of.

### 2. Capacity-aware placement score

For a structural-gap good `g` and a candidate buildable site `s`:

- **`capacity(s, g)`** = additional output `s` can host = (buildable units at `s`) × `outputPerUnit(g)`.
  Buildable units = remaining deposit slots for `g`'s resource (tier-0) or `generalSpace ÷ spaceCost`
  (tier-1+), staffing-bounded by the housing co-built in step 4. *(This is the "3 extractors needed,
  room for 1" cap.)*
- **`score(s, g)`** = the structural demand the site could serve, each unit **discounted by its delivery
  cost** — allocate `capacity(s, g)` to the reachable structural deficits **nearest-first** (via
  `routeCost`), summing `allocated ÷ routeCost` per deficit. Capacity and proximity each count once: a
  site that can serve all of a nearby gap outranks one that can serve only a fraction, or one equally
  capable but farther. This is the exact build-side mirror of the logistics matcher's value function.

### 3. Greedy build + cascade

Build greedily — highest score first — applying count-ups up to each site's capacity and a faction
**build budget**, decrementing the remaining gap and advancing (structurally identical to
`matchFactionTransfers`). When no single site can cover a gap, the build spreads across sites, this cycle
or over subsequent ones.

For **tier-1+ goods**, building a factory creates a *new* input deficit at that site; if no reachable
input surplus exists, that becomes the next structural gap and the planner builds the input production
reachably next cycle. So the planner **builds the vertical chain backward across reachable sites by
cascade** — demand-pulled from the finished good, no recipe look-ahead. This is precisely the import-fed
manufacturing the old seeder structurally could not place. Manufacturing hubs take several agency cycles
to come online — intended (slow agency clock).

### 4. Staffing self-consistency

Build always **co-builds housing** alongside production (the seeder's existing `labourDemand ≤ popCap`
rule via `housingPopCap`/`labourDemand`), and population fills it over subsequent ticks via the
living-world loop. So even demand-pull build does a *bounded* "plan for population" — bounded by realised
reachable demand, never by deposit size, which is what keeps it from regressing into the tier-0 glut.

### Budget & cadence (first-draft, simulator-calibrated)

- **Cadence:** the agency clock — reuse logistics' `LOGISTICS_INTERVAL` (48 ticks), `dependsOn:
  ["economy"]`. Build runs alongside logistics each agency cycle (logistics distributes what exists;
  build addresses what structurally doesn't). Build effects are gradual, so cadence is not sensitive.
- **Budget:** mirror `systemLogisticsGeneration` — per-system generation `population ×
  BUILD_GENERATION_PER_POP`, summed to a faction pool, **free + capacity-bounded in v1** (no treasury).
  Spent as building-units placed. This paces the build *rate* (population-scaled — bigger factions
  develop faster) so growth stays slow and legible.
- **Removal** stays SP3.5 disuse-decay. Deliberate demolish-for-redeployment is full-agency, later.

---

## Component 2 — the minimal-core seeder

Replaces `industry-seed.ts allocateIndustry`'s deposit-maxing with the planner-as-seeder approach:

- Pick **~5 systems per faction**, clustered near the homeworld, as developed cores. Everything else in
  the faction's (statically-owned) territory is **inert** — substrate only (deposits, space,
  habitability), zero population, zero industry.
- Drop a modest **seed population** on each core (below carrying capacity, locally sustainable — vision
  §3.4), then run the **planner's subsistence pass once**: a restricted, *local-only, tier-0-only* form
  — build food / water / basic extraction to meet the seed pop's own tier-0 civilian demand, plus
  housing to staff it. No reachability, no cascade, no manufacturing.
- **Self-start property:** civilian demand includes tier-1 goods (consumer_goods, medicine, …), so a
  tier-0-only core runs **tier-1 structural deficits from tick 0** — exactly the gaps that kick off the
  manufacturing cascade the moment age-forward begins. The galaxy bootstraps from the emptiest coherent
  state.

A core is **self-sufficient by construction** (a closed local tier-0 loop needs no agency judgment), so
it is inspectable and verifiable — the opposite of eyeballing a hand-authored mature galaxy.

---

## Component 3 — the age-forward harness

- **Mechanism:** extend the simulator (`lib/engine/simulator/economy.ts` already runs
  economy/logistics/decay/migration in-memory) to also run the new `factionBuild` processor, start from
  a freshly minimal-core-seeded universe, and run **N agency cycles**. Then **snapshot the matured
  in-memory state** (SystemBuilding counts, population, market stock) back as the canonical seed.
- **Determinism:** seeded RNG only (the sim already threads `RNG`; `Date.now()`/`Math.random()` are
  unavailable), so a world-seed deterministically produces the same matured galaxy — reproducible seeds.
- **Maturity criterion:** run until the key metrics **plateau** (total population, manufactured-goods
  coverage, structural-deficit count), capped at a max N. First-draft N validated in the simulator; the
  plateau check confirms N is sufficient. New start-point = between "mostly empty" and today, leaning
  emptier — set by the chosen maturity, not hand-tuned.
- **Dependency:** the harness needs the full agency stack (build + logistics) to produce a meaningful
  mature state, so harness and build-up land together in Stage 1. On a build-less seed the harness only
  reproduces decay (already measured).

---

## Reachability / hop cap

Build reuses logistics' reachability horizon, so the two share one setting. `MAX_HOPS = 4` is partly a
real BFS-precompute bound (`computeBoundedHopDistances`, ~`V × branching^maxHops`) but it under-serves
manufactured goods (a lone producer is often 6–10 hops away). **Recommendation:** keep the cost model
(`qty × distance`) as the primary limiter and raise the hard cap toward the live cache's 8 (or decouple),
**after measuring the precompute at 10K**. Treated as a tuning/validation item, not a blocker.

---

## Data model

**No new schema for Stage 1.** Build increments existing `SystemBuilding.count`; population and market
stock already exist; `factionId` stays static (Stage 2 makes it dynamic). A `FactionBuild` summary row
(budget/spent, mirroring `FactionLogistics`) is **optional and deferred** — there is no Stage 1 UI.

---

## UI (deferred — display-only)

No UI in Stage 1 (the engine + seeder + harness are validated in the **simulator**). When build goes
**live** (after the Prisma adapter + registry land), the only surface is a small modification to the
**existing Industry tab**: a **direction cue** per building/system — *developing* (count trending up) /
stable / *declining* (count trending down) — complementing, not replacing, the existing utilisation
health colours (idle/collapsing read in-use-vs-built; direction is a different axis). Its value is a
trade signal: it shows which systems are growing (where demand is about to rise).

**Display-only** — build is a faction autonomic behaviour, not a player action (player-driven building
is the separate `player-facilities` doc). **No construction queue / progress bar:** `count` is a
continuous Float that ramps over agency cycles (the mirror of decay), so there is no discrete
in-progress build to render — a progress bar would misrepresent the mechanic. The only data question
for that phase: the direction cue needs a recent count-delta signal (a small per-building signed delta
written as build/decay touch `count`, or derive system-level direction from the existing
population/unrest trend).

---

## Processor architecture

Follows the convention (typed `World` · Prisma adapter · in-memory adapter · pure body):

- **New `factionBuild` processor** — `DirectedBuildWorld` interface + `PrismaDirectedBuildWorld` +
  in-memory adapter + pure `runDirectedBuildProcessor` body. Owns: structural-deficit classification →
  placement scoring → greedy count-ups + co-housing.
- **Shared engine helper** — extract the deficit/surplus classification + `routeCost` reachability out of
  `directed-logistics.ts` into a shared module both processors consume (DRY; one classification
  definition).
- **`industry-seed.ts` retired/replaced** — the deposit-maxing `allocateIndustry` is superseded by the
  seeder's one-shot subsistence call into the planner.
- **Cadence/ordering:** agency clock, `dependsOn: ["economy"]`, runs each agency cycle. Build is its own
  processor (creates supply); logistics stays its own (moves supply) — distinct concerns.

---

## Success criteria (coarse, audit-grounded)

Age a minimal-core seed forward in the simulator and confirm:

- **Growth from cores:** ~5 tier-0 cores per faction develop into a populated, producing mature galaxy —
  no collapse, no runaway, no uniform sprawl.
- **Manufacturing emerges:** tier-1+ P/C rises from ~0 toward healthy via the cascade, *structured* by
  recipe depth (deep goods rarer but present), driven by demand not seeding.
- **Logistics works on the grown world:** surplus→deficit flows move goods; the suppliable middle
  survives as it develops; structural gaps fill by build over cycles.
- **Coherence:** no phantom industry (everything built is demand-justified + staffed); the tier-0 glut
  shrinks as manufacturing draws raws; P/C ratios emergent and sane.
- **Negative space preserved:** not every system thrives; stranded/inefficient systems remain; stable
  floor + improvable frontier (coarse health bar, not "make everything thrive").
- **Determinism:** same world-seed → same matured galaxy.

---

## Build phases (each shippable; PR-sized)

1. **Build-up engine + `factionBuild` processor + wiring.** Shared classification/reachability helper;
   structural-deficit signal; capacity-aware placement; greedy build + cascade + co-housing; budget on
   the agency clock. Engine pure + unit-tested; in-memory + Prisma adapters; tick-pipeline wiring. Prove
   build alone develops a hand-seeded world in the simulator.
2. **Minimal-core seeder.** Replace `allocateIndustry` deposit-maxing with the planner's one-shot
   subsistence pass on ~5 clustered cores + inert frontier. Verify cores are self-sufficient by
   construction.
3. **Age-forward harness + snapshot-back.** Simulator extension to run the full agency stack from a
   minimal-core seed to maturity; deterministic snapshot to the canonical seed; plateau-based maturity
   check.
4. **Validation pass.** Age-forward measurement against the success criteria; tune budget/cadence/hop-cap
   first-draft constants.

Bundle into 2–3 PRs per the project's phase-PR convention.

---

## Out of scope (explicit)

Colonisation / un-owned space / dynamic `factionId` (**Stage 2**) · speculative build-ahead-of-demand ·
recipe look-ahead · deliberate demolish-for-redeployment · treasury / money / construction-input gating ·
build-planner priorities 3–4 (bottleneck relief, strategic/military) · doctrine/government weighting ·
logistics Contracts/UI (Phases 2–4) · military ceiling · events · war.

---

## Open questions / tuning (settle in the plan or via simulator)

- `BUILD_GENERATION_PER_POP`, build-unit cost, and the build/logistics cadence relationship.
- Distance-weighting curve in `reachableUnmetDemand` (and the hop/fuel blend, shared with logistics).
- Seed-pop magnitude per core; core count (≤5) and spatial-cluster selection rule.
- Age-forward N (ticks to maturity) and the plateau metric thresholds; 10K-scale runtime of the snapshot
  run.
- `MAX_HOPS` raise vs cost-model-only; BFS precompute budget at 10K.
- Whether the shared classification helper lives in `directed-logistics.ts` or a new
  `lib/engine/faction-agency/` module.
