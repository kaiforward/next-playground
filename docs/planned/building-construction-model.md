# Building & Construction Model

Status: **Designed, not yet built.** Design spec for the redesign of the build/construction layer,
brainstormed 2026-07-08 (informed by a study of Stellaris, EU5, and Victoria 3). It reshapes the
build layer of the substrate reset (`substrate-reset.md`) and is the foundation the player seat
(SP1) builds its construction surface on. Precedes the player seat.

---

## Headline

A building is a **discrete-level capacity** you **construct over time via committed projects**, that
produces **something** (a market good, an abstract capacity, or a modifier) in proportion to how
**utilized** it is, and that **contracts by whole levels only when abandoned for a sustained
stretch**. Four coupled ideas, drawn from the genre and fused with our physical substrate:

1. **A building is one uniform skeleton with a *typed* output.** `inputs + staffing → output`, where
   `output` is a discriminated union — a **market good** (priced, sold), an **abstract capacity**
   (un-priced running balance: pop-cap, a skill-licence ceiling), or a **modifier** (a % buff). One
   shape for every building; today's per-type special-cases dissolve. (EU5's single building object;
   Victoria 3's typed output — bureaucracy/innovation are capacities, not market goods.)
2. **Capacity is discrete; utilization is continuous.** Built capacity is an **integer level count**
   — you commission *whole* levels, each a fixed chunk of capacity for a fixed work + cost. Staffing,
   utilization, and output flow **continuously** underneath (a level can run at 70%). Construction is
   lumpy (the game decision); the economy is smooth. (Victoria 3's integer levels + continuous
   employment; EU5's integer levels + floating staffing.)
3. **Construction is committed, timed, and throughput-paced — never instant.** You commission a
   **project** ("build a 4th Ore Extractor level here"); it carries a **work cost** in construction
   points; a **per-faction throughput pool** funds a queue; a **per-build absorption cap** makes big
   builds take a real minimum time and makes the pool spread across parallel fronts. Duration is
   *emergent* (work ÷ absorbed points), never a stored timer. (Victoria 3's construction sector +
   queue; EU5's "Constructions capacity" parallel fronts.)
4. **Decay is slow, whole-level, and buffered.** Capacity is a **ratchet** — up via projects, down
   only via sustained-abandonment contraction (a hysteresis-buffered countdown that removes a whole
   idle level, and resets if the level refills) or a discrete teardown event. Utilization floats and
   *recovers* freely. (Neither EU5 nor Victoria 3 auto-erodes capacity toward usage — they keep
   capacity sticky and let utilization move; we keep a deliberate slow contraction for the
   barren-galaxy realism, but relaxed and legible.)

**Why now, and why this:** the current build layer — a fractional building `count` that an autonomic
per-system monthly budget accretes instantly, with capacity decaying toward usage each tick — was
shaped by the **AI-only** world, where no one commissions or watches a build. It is *illegible* (no
project), *uncommitted* (nothing to commit to), and *untimed* (no real duration). Those are exactly
the three things a player-facing construction system needs, and the player seat is next. The change
is **localized**: the goods/pops economy (26-good input→output chains, prices-from-stock, labour and
skill-tiered pops, trade flow) is genre-agnostic and *kept* — it computes output *from* building
capacity, while this redesign changes only how capacity is *born, staffed, and shed*. Different
processors, so the production/price/chain math is untouched.

---

## Locked design decisions (with rationale)

| Decision | Rationale |
|---|---|
| **Keep the goods/pops economy; replace only the build layer** | The economy is Victoria-3-class and paradigm-agnostic; the build layer is the sole misfit for a player. Economy reads capacity and computes output — different processors, so it is untouched. |
| **Discrete construction (integer levels), continuous staffing/output** | Lumpiness *is* the game decision (you commit to a whole level at a fixed cost — the resource-balancing challenge). Fractional construction trivialises it ("build exactly 0.3 to top up"). Continuity is kept where it matters — staffing and output. |
| **One uniform building with a typed output** | A single `inputs + staffing → output` skeleton, output ∈ {market good, capacity, modifier}, dissolves the current per-type decay/economy special-cases (housing, academy, complex each stop being an awkward branch). |
| **Abstract outputs stay off the market** | Skill-licences and %-buffs get their own un-priced balance track. Routing them through the good/price/stock economy would produce nonsense prices and coupling. (Victoria 3's explicit choice for bureaucracy/authority.) |
| **Per-faction construction throughput pool** | A pool you *aim* is the player's core construction verb, scales to a galaxy of hundreds of systems, and is closest to EU5's central "Constructions capacity" feel. Per-system serial (Stellaris) is glacial/meaningless at scale. |
| **Duration emergent from work ÷ throughput, plus a per-build cap** | No per-building duration constants. The cap sets a minimum build time (work ÷ cap) that wealth can't bypass — you build *more at once*, not one thing instantly — and makes the pool spread across parallel fronts (fronts ≈ pool ÷ cap). This is the honest fix to "you can't instantly build a huge amount of industry." |
| **Automation = the default queue policy; one code path** | The current autonomic planner becomes "auto mode" (auto-queues toward physical ceilings). The player (SP1) hand-queues/reorders the *same* queue. Matches "one tick body, no sim-only bots." Automation makes worse choices than a human, cheaply — never bypasses throughput. |
| **Slow, whole-level, buffered decay (contraction)** | Empty buildings shouldn't persist forever (barren-galaxy realism, a kept design value), but the current decay is too twitchy. A hysteresis-buffered countdown that removes a whole idle level — and resets on recovery — is legible and fair. |
| **Ownership as a system control flag, not a building** | Outpost/station are *control*, not production — a location flag (`unclaimed | controlled | developed`), exactly how EU5/Victoria 3 treat control/incorporation. Kills the marker-riding-the-decay-loop bug and simplifies the claim step. |

---

## The model

### 1 — A building: capacity + utilization + typed output

Every building is one skeleton: **`inputs (0+ goods) + staffing (labour, skill-gated) → output`.**

- **Built capacity = an integer level count.** Each level of a building type is a fixed chunk of
  capacity (per-type; simplest case, one capacity unit per level). You construct *whole* levels.
- **Utilization ∈ [0,1]** = `min(staffing, inputs, demand-for-its-output) / capacity`. **One formula
  for every output type** — this uniformity is what removes the current per-type decay branches. It
  is a generalisation of what we already compute: the labour head-count ratio (`effectiveFulfilment`
  / `labourFulfillment`), the recipe `inputGate`, and the seller-side `outputUptake`.
- **Output = levels × per-level-capacity × utilization × yield.** Continuous, because utilization is.
- **`output` is a discriminated union:**
  - **MarketGood** — priced, sold into the market (extractors, factories). Unchanged from today.
  - **Capacity** — an **un-priced running balance** (income vs use each tick, no stock/price): a
    housing level's pop-cap, an academy level's skill-1/skill-2 licence ceiling. Consumed by the
    thing that needs it (pops occupy housing; skilled work draws the licence).
  - **Modifier** — a % buff applied while the level exists and is utilised (a specialisation
    complex's family-yield multiplier). No market-side consumer.
  - **none** — a building whose only effect is employment/holding (rare).

| Our building | Output kind | Utilization driven by |
|---|---|---|
| extractor / factory | **MarketGood** | staffing × inputs × buyers for its good |
| housing | **Capacity** (pop-cap) | pops occupying it |
| academy (vocational school / research institute) | **Capacity** (skill-1 / skill-2 licence) | skilled work actually drawing the licence |
| specialisation complex | **Modifier** (% family yield) | how much of the buffed family is actually produced |
| outpost / space-station | — (becomes a **control flag**, §4) | n/a |

**Modifier utilization** has no demand-side consumer, so its utilization proxies off the thing it
buffs (how much of the buffed family is actually produced) — a small contained branch, far fewer
special-cases than today.

### 2 — Construction: committed, throughput-paced, discrete-level projects

Capacity no longer drifts up from a monthly budget. It grows **only via committed construction
projects.**

- **A project** = "build N level(s) of type T at system S." Chosen, resourced, enqueued. It carries a
  **work cost** in construction points (per building type — a Shipyard level is more work than a
  Housing level). A level is **under construction** (contributes nothing) until its accumulated work
  reaches its cost, then it **lands** as a full, staffable level.
- **A per-faction throughput pool** = construction points per month. It scales with the empire early;
  later it becomes a capacity you *build up* (a construction building type), and later still it
  consumes construction goods (SP3).
- **A per-build absorption cap** = the most points a single build can absorb per month (physical:
  one site can only absorb so much labour/materials at once). This does two jobs:
  1. **Minimum build time** = `work ÷ cap` months, which **wealth cannot bypass** — extra throughput
     builds *more things at once*, never one thing instantly.
  2. **Parallelism** — the pool spreads across multiple builds, so **effective parallel fronts ≈
     pool ÷ cap** (grow the pool → more fronts, the emergent analog of EU5's build slots).
- **The queue** funds front-first each month: each active build takes `min(cap, its remaining work,
  pool left)`; leftover cascades to the next build; a build completes at `accumulated ≥ work`.

**Worked example** — same queue, small vs developed faction (work: Housing 100, Ore 200, Shipyard
800; cap 100/month):

- *Small faction, pool 100/month* (pool = cap → effectively serial): Shipyard soaks all 100/month →
  **8 months**, then Housing. One front at a time, slow — a young empire builds one thing at a time.
- *Developed faction, pool 400/month* (cap 100 → up to 4 fronts): month 1 — Shipyard +100, Housing
  +100 (**done**), Ore#1 +100, Ore#2 +100; month 2 — Shipyard +100, Ore#1 (**done**), Ore#2
  (**done**); … Shipyard still **finishes month 8** (capped). Four parallel fronts; small builds
  finish fast; the big build still takes its minimum time.

**Automation is the default driver.** Today's autonomic planner becomes "auto mode": it populates the
queue toward the physical ceilings (habitable land → housing → labour-gated industry, as it does
now), and the throughput pool paces it. In SP1 the player hand-queues, reorders, and prioritises the
*same* queue, with per-domain automation toggles. **One code path**; automation just makes the
decisions a human would, less well.

### 3 — Decay: slow, whole-level, buffered contraction + teardown events

Capacity is a **ratchet**: up via projects, down only via:

1. **Sustained-abandonment contraction.** A level that stays **unused** past a hysteresis buffer of
   `X` months is torn down **as a whole level**. "Unused" is the §1 utilization for *any* reason — no
   pop, no inputs, or no buyers. The **marginal (least-utilised) level** is the one on the clock. The
   countdown **resets** if the level refills before it expires — so a one- or two-month dip costs
   nothing; only sustained emptiness contracts. This is today's decay, **relaxed, buffered, and
   whole-level**, and now uniform across all building types via the one utilization formula.
2. **Teardown events.** The unrest-driven collapse becomes a discrete *event* (a failing world sheds
   a level), plus a player **demolish / mothball** action later (SP1). Never a monthly drift.

Utilization itself floats freely and **recovers** — an idle level refills when conditions improve,
instead of having lost the capacity (the thing today's continuous decay wrongly destroys).

### 4 — Ownership: a system control flag, not a building

- **`control ∈ {unclaimed, controlled, developed}`** is a field on the system. Outpost and
  space-station leave the building catalog entirely.
  - **unclaimed** — `factionId: null`, empty frontier.
  - **controlled** — owned, border-closing, routes logistics cleanly; no development. (The claim
    step sets this flag, not a building row.)
  - **developed** — the develop-gate: development builds are allowed. Replaces today's
    `hasStationFacility(buildings)` check with `system.control === 'developed'`.
- **The flag is the semantic interface.** Everything downstream (borders, logistics routing, the
  develop-gate, the map) reads the flag, never "is there an outpost building." So a later **conquest**
  layer can back the flag with a **destroyable control structure with hit points** (grind it down →
  the flag falls back toward `unclaimed`) without touching any downstream reader. The flag now is the
  abstraction; the HP-structure later is an implementation upgrade behind it — a non-breaking
  evolution.

---

## What changes in code (grounded pointers, not the build plan)

- **Goods economy — ~unchanged.** `lib/tick/processors/economy.ts` reads building capacity and
  computes `capacity × utilization × yield` — essentially today's `count × effectiveFulfilment ×
  inputGate × yield`. The typed-output split touches only the non-MarketGood buildings.
- **Building count → integer levels.** `WorldBuilding.count` (`lib/world/types.ts`) becomes an
  integer level count; world-gen (`lib/world/gen.ts`, `lib/engine/universe-gen.ts`,
  `lib/engine/faction-gen.ts`) re-seeds systems in whole levels. `SAVE_FORMAT_VERSION` bumps.
- **Decay engine — relaxed, unified, whole-level, buffered.**
  `lib/engine/infrastructure-decay.ts` (`computeSystemDecay`) collapses its per-type branches into
  the one utilization ratio, adds the hysteresis buffer + whole-level removal, and drops continuous
  fractional erosion. `lib/constants/infrastructure.ts` gains the buffer length.
- **`directed-build` → a construction-project engine.** `lib/engine/directed-build.ts`
  (`planFactionBuilds`) and `lib/tick/processors/directed-build.ts` become: enqueue projects (auto
  policy toward ceilings), fund the per-faction throughput pool through the queue with the per-build
  cap, land completed levels. This is the largest new piece.
- **Typed-output building catalog.** `lib/constants/industry.ts` gains an `output` discriminant per
  building type (MarketGood / Capacity / Modifier); the abstract-capacity balance track is new
  (un-priced). Outpost/station leave the catalog.
- **New `World` state (all JSON-serializable):** a **per-faction** construction-project queue, the
  per-faction throughput amount, and `WorldSystem.control`. Utilization may be derived per tick rather
  than stored.

---

## Explicitly deferred (not this phase)

- **Money / treasury** → SP1/SP3. Throughput itself is the scarce resource for now (no gold cost yet).
- **Construction-goods cost** — throughput consuming priced materials → SP3 (the "construction-goods"
  phase), folding into the same throughput flow.
- **Player construction surface** — commissioning, reordering, per-domain automation toggles → SP1.
  This phase builds the model autonomic-driven so the AI-only game keeps working.
- **Upkeep-as-pressure** (idle levels costing ongoing money/goods, EU5-style) → SP1/SP3 (needs money).
- **Conquest / destroyable control structure with HP** → the war phase. The `control` flag is left
  ready for it (§4).
- **Emergent pop-promotion** (buildings raising a national qualification rate → pops promote into open
  higher-tier jobs, the EU5/Victoria 3 model) — a possible later refinement of the academy
  skill-licence model; not this phase.
- **Precision economy calibration** — coarse only this phase (no `NaN`/`Infinity`/runaway/pinning;
  construction visibly takes months; the galaxy fills partially). Precision is perishable and later
  phases move the target.

---

## Relationship to the roadmap / re-sequencing

- This spec **supersedes the build-layer parts of `substrate-reset.md`** (SP0). The monthly pulse
  (shipped) and the emergent-civ world-gen inversion (shipped) stand. The parked claim step returns
  **simpler** — it sets `control = controlled`, not an outpost building — and the develop step sets
  `control = developed`. The penalised-cross-unowned-logistics + profiling work folds in after.
- This model is the **substrate SP1 (player seat)** builds its construction UI and command queue on —
  the whole point of the redesign is that the player seat lands on a legible/committed/timed
  construction model rather than the autonomic drift.
- `grand-strategy-vision.md` §8 and `substrate-reset.md` should be reconciled to this reorder when the
  implementation plan is written.

---

## Open questions (to pin in implementation, sensible defaults proposed)

- **Per-build vs per-system absorption cap.** Default: **per-build** (each active build ≤ cap/month).
  Add a per-system cap ("one world can only host so much construction at once") only if single-system
  over-parallelism looks silly in testing.
- **Level-lands-on-completion vs gradual accrual.** Default: **lands on completion** (a level under
  construction contributes nothing until done) — the committed-project feel; cleaner with discrete
  levels.
- **Per-type work costs + per-level capacity chunks.** Coarse first-cut, simulator-validated for
  coherent pacing (big builds span months, young empires build serially), not tuned.
- **Utilization stored vs derived.** Default: **derived each tick** from staffing/inputs/demand (no
  new persisted field), matching how the economy already derives fulfilment.
- **Throughput pool sourcing this phase.** Default: **derived** (scales with the empire, like today's
  `pop × GENERATION_PER_POP` but pooled per faction); buildable/goods-costed later.
