# Economy Specialisation — Forced Trade Gradients via Industry Differentiation

> **Status:** Designed, not built — created 2026-06-30 (brainstorm). Sits inside **SP5 autonomic-light**,
> and **expands the roadmap's narrow "2a — preserve a spread" item** (in
> [economy-scaling-and-trade-rework.md](./economy-scaling-and-trade-rework.md)) from "build/decay pacing"
> into a real structural-specialisation track. Decomposes into ordered stages, each its own spec → plan →
> build. Authoritative sequence in [economy-simulation-vision.md](./economy-simulation-vision.md) §13.

## Headline

The matured economy is **flat** — every developed system can make everything, so there's nothing to
trade and no price spread to arbitrage. This track makes the *baseline* economy structurally specialise
so that durable trade gradients exist **before** any agency or events are added. The principle:

> A system's labour, space, and development must be **insufficient to build the full goods basket at the
> scale its population demands**, so it specialises in a few goods and imports the rest.

Tier-0 already works this way — **deposits** are a hard geographic gate, so no system extracts what isn't
in its ground. Tier-1+ manufacturing has **no equivalent gate** (it needs only labour + space, both
fungible), so it self-supplies everywhere and the gradient collapses at maturity. This track gives
manufacturing its own specialisation pressure, through **industry differentiation** — differentiated
building costs, specialisation anchor buildings, and a built skilled-labour endowment.

**Crucial constraint (scope):** every lever here works **through the existing autonomic build planner and
physical-economy tick** — we sharpen the *constraints*, and the planner's optimisation produces
specialisation *emergently*. **None of it needs the unbuilt faction-agency layer** (treasury,
doctrine-weighted build, directed-logistics orders). Player trade/missions and ship re-pricing stay
**parked** — they're downstream of having an economy worth trading in.

## The problem (evidence)

The live constants (`lib/constants/industry.ts`, `lib/constants/physical-economy.ts`) show why the
baseline flattens:

- **Flat factor costs.** Every production building, *every tier*, costs a flat `DEFAULT_LABOUR_PER_UNIT =
  25` to staff and `DEFAULT_SPACE_COST = 1.0` to place. Nothing makes advanced industry harder to host
  than extraction.
- **One building over-covers a huge population.** `output_g / need_g` (people one building's output
  feeds) runs into the hundreds–thousands for nearly every good, while a building needs only 25 to staff.
  Summed across all 26 goods, **~40% of a population working could self-supply that population's entire
  civilian basket** — and tier-1+ has nothing stopping a developed system from doing exactly that.
- **No manufacturing comparative advantage.** Tier-0 production is multiplied by a per-deposit
  `yieldMult`; tier-1+ uses a hard-coded `×1`. There is no built or geographic reason for one system to
  be *better* at electronics than another.

Result (confirmed by `npm run audit:economy`): a young galaxy has a rich spread (deep-chain goods starved,
raws glutting), but the autonomic build planner fills out manufacturing everywhere and decay trims idle
capacity, **collapsing the gradient ~1.27× → ~1.06× over thousands of ticks.**

### Three failure modes (the organising frame)

A flat galaxy is really three independent failures. Winning one while the others leak still gives a flat
galaxy, so the track must address all three:

| # | Failure mode | Plain English | Lever family |
|---|---|---|---|
| 1 | **Breadth** | every developed system can make *everything* | force specialisation |
| 2 | **Volume** | systems over-build / over-produce what they *do* make | build-pacing + decay |
| 3 | **Diffusion** | surplus spreads and re-flattens prices across space | transport friction |

## Design philosophy

- **Structurally-specialised baseline, not a flat canvas.** Agency and events are *gradient-movers* and
  *shock-generators* that sit on top — they re-flatten a perfectly flat base rather than create gradient
  from it. The baseline must already breathe. (This refines `negative-space-economy.md`: the negative
  space is *unmet demand a system can't satisfy locally*, not a flat over-supplied world.)
- **Specialisation by physical primitives, no scripting.** We never label a system "forge world." We make
  it so the planner *can't* build a forge world that also feeds itself, so it imports food. Emergence from
  constraints — the `user-emergent-realism` north star.
- **Everything routes through industry + autonomic build.** No faction-agency dependency. The planner
  already does capacity-bounded scoring; sharper constraints change *what* it builds without new agency.

## Lever inventory (with supersession decisions recorded)

The full set, deduped under the "no simpler-worse-version; if X supersedes Y, build only X" rule.
Decisions recorded so they aren't re-litigated:

**Mode 1 — Breadth (forcing specialisation):**

- **Per-good labour cost** — `labourPerUnit` varies by good (and therefore tier). Advanced manufacturing
  is labour-intensive; extraction/automated processing is light. *(Merges the earlier "tier-scaled
  labour" + "per-good labour" — per-good subsumes tier-scaling; you just set the numbers.)*
- **Per-good space cost** — `spaceCost` varies by good. Shipyards/foundries are *enormous*; a gas
  harvester is sparse. You physically can't fit the whole tier-2 basket on one body.
- **Specialisation complexes** (anchor buildings) — *see [its section](#specialisation-complexes-anchor-buildings)*.
  *(This is the chosen lever for manufacturing comparative advantage. It supersedes two earlier ideas:
  (a) **trait affinity for tier-1 goods** — dropped, because no physical trait sensibly "makes
  electronics better"; and (b) **continuous economies-of-scale** — the anchor IS economies-of-scale, done
  as a discrete, hard-capped, self-limiting building rather than a runaway-prone marginal-efficiency
  curve. We build the anchor, not the continuous version.)*
- **Skilled labour (infrastructural)** — *see [its section](#skilled-labour-infrastructural)*. The
  development-axis endowment gate. *(Supersedes the "scalar-proxy" stopgap I floated — dropped.)*

**Mode 2 — Volume (over-capacity):**

- **Build-pacing** — the autonomic build budget stays *below* total need by design (the negative-space
  intent); the planner stops filling toward potential once need is met.
- **Tier-scaled decay/upkeep** — advanced industry sheds idle capacity faster, so tier-2 only survives
  where genuinely supplied + demanded → concentrates at viable hubs.

**Mode 3 — Diffusion (the flattener):**

- **Keep diffusion leaky** — `TRADE_SIMULATION.FLOW_BUDGET` + distance attenuation tuned so gradients
  *survive* over distance. Strong diffusion flattens even a perfectly specialised economy.
- **Sharper distance attenuation** — goods don't travel far cheaply → regional price differences persist
  → arbitrage over distance (trade as a spatial game).

**Demand-side (cross-cutting — the half supply-side levers can't cover):**

- **Demand concentration** — civilian consumption varies by a system's *character* (its built profile /
  population), not just headcount. Creates gradients independent of supply: a forge world is a bottomless
  *importer* of intermediates even if everyone produces the same things. (Today consumption is flat
  per-capita everywhere — `GOOD_CONSUMPTION × population`.) Pairs with specialisation: a tier-2-specialised
  system is both the supplier of tier-2 *and* the big importer of tier-1 inputs → strong opposing flows.
- **Amplify production-input demand** — a magnitude knob on existing recipe draws, so a manufacturing
  hub's *import* pull dwarfs its civilian need. (Structure exists; this is tuning.)

## Specialisation complexes (anchor buildings)

A discrete building type representing a system's commitment to a specialty:

- **Large space footprint** — eats the general space you'd otherwise spend on breadth or housing.
- **Hard per-system cap (1–2)** — "too specialised to host more."
- **Yield multiplier on all production of its good (or good-group) in that system** — the tier-0 deposit
  `yieldMult`, but *built* instead of geological.

Emergent result: a system that builds the Electronics Complex becomes the regional electronics
powerhouse (high output, low local price, exports), and *because* it spent the space, it imports
everything else. Comparative advantage by **investment choice** — self-capping (the cap + space limit
prevent monopoly runaway), legible, and built by the autonomic planner with no agency.

**Cost in the agency-free near-term** is paid in **space + the cap** (you give up breadth), not credits —
the *capital* cost arrives later with the treasury (full SP5 agency). The tradeoff already bites without it.

## Skilled labour (infrastructural)

Manufacturing's development-axis endowment gate, delivered through an **industry "academy / development"
building** — no faction-facility dependency. Population stays a **single scalar**; the academy raises the
ceiling on *how much skilled work that population is allowed to perform* — the pops themselves are
unchanged.

```
skilledDemand = Σ count_b × skilledLabourPerUnit_b     // ~0 for tier-0/1, high for tier-2
skilledCap    = Σ academies × SKILLED_PER_ACADEMY      // "X pops may act as skilled"
skilledFulfil = min(1, skilledCap / skilledDemand)     // pure infra gate — population-independent

labourDemand  = Σ count_b × labourPerUnit_b            // UNCHANGED: the heads still must exist
labourFulfil  = min(1, population / labourDemand)       // UNCHANGED headcount gate

// a skilled good needs BOTH gates; tier-0/1 only need labourFulfil:
output_skilled = count × outputPerUnit × min(labourFulfil, skilledFulfil) × yield
```

A frontier world with the population and the space but **no academies** has `skilledFulfil = 0` → it
physically cannot run high tech, no matter how big it grows. The academy is itself a building: it eats
general space and must be staffed (adds to `labourDemand`), so becoming a tech hub costs space + pop on
academies *and* tech labs → you can't also be broad → you import the rest. No extra population clamp is
needed — `labourFulfil` already throttles output if you lack the heads to fill academy-unlocked slots, so
`skilledCap` is purely an additional ceiling and the two gates compose.

*(v1 simplest: a skilled good's whole labour is "skilled." Splitting each building into general + skilled
portions is a later additive nuance, not a rework.)*

**Demographic skilled labour is recorded as a possible future layer, not superseded.** Modelling skill as
a *kind of person* (population becomes a vector; skilled workers **migrate to jobs**) is evocative but
fights the vision's §4 keystone (population is a scaled magnitude, not individuals) and touches every pop
subsystem. The infrastructural model is a **different, self-consistent endpoint** — *not* a worse version
of demographic — and skilled-migration can layer on later as its own feature if we ever want it. Decision
deferred deliberately; infrastructural ships now.

## Staged decomposition

Each stage is its own spec → plan → build, ordered for reviewability. All agency-free. The guardrails
stage is **last** so we tune diffusion/decay against the *real* gradient the structural stages create
(the roadmap's original "2a build/decay pacing" is folded into S5).

| Stage | Lever(s) | Failure mode | Needs agency? |
|---|---|---|---|
| **S1** | Per-good **labour + space** cost; amplify input-demand magnitude | Breadth (factor scarcity) | No |
| **S2** | **Specialisation complexes** (manufacturing CA + economies-of-scale) | Breadth (comparative advantage) | No |
| **S3** | **Skilled labour via industry** (academy → skilled pool gates tier-2) | Breadth (development endowment gate) | No |
| **S4** | **Demand concentration** (civilian consumption by system character) | Flat demand | No |
| **S5** | **Guardrails & tuning** — build-pacing, tier-scaled decay, diffusion friction | Volume + Diffusion | No |

First-cut shape (first-draft, simulator-calibrated — only relative shape matters):

- **Labour:** tier-0 light, tier-2 heavy (e.g. ~10 → ~25 → ~60). Per-good within tier where it reads true
  (labour-heavy textiles/consumer-goods/luxuries vs automated refining).
- **Space:** extraction/processing modest; the most-integrated tier-2 (shipyards, foundries) large.
- **Anchor buff & cap:** a meaningful multiplier (enough to make concentration clearly worth the space),
  cap 1–2 per system.
- **Skilled:** `SKILLED_PER_ACADEMY` and tier-2 `skilledLabourPerUnit` set so a tech hub needs a real
  academy investment a frontier world can't casually match.

**Genuinely deferred (downstream — this track feeds them, unchanged in sequence):** full faction agency
(treasury / doctrine-weighted build / directed-logistics orders), the contract-model rework, ship
re-pricing, events, war. None of the near-term stages is a worse-version of these — they're different
layers that sit on the gradient we're building. Demographic skilled labour and continuous
economies-of-scale are captured above as explicitly-not-now.

## Relationship to existing docs

- **[economy-scaling-and-trade-rework.md](./economy-scaling-and-trade-rework.md)** — this **expands its
  "2a — preserve a spread" item** from build/decay pacing into the full structural track. The contract-model
  rework (its sub-project 3) depends on the spread this track creates.
- **[economy-simulation-vision.md](./economy-simulation-vision.md)** — realises §8 (build space, the
  industrialize-vs-feed pull) and §11 (regional specialisation, need-cascades) at the baseline level, and
  pre-builds the substrate full faction agency (§12) will later *decide* over.
- **[negative-space-economy.md](./negative-space-economy.md)** — refined: negative space = locally-unmet
  demand, produced by forced specialisation, not a flat over-supplied world.
- **Live code touched:** `lib/constants/industry.ts` (per-good labour/space, academy + anchor building
  types), `lib/constants/physical-economy.ts` (demand concentration), `lib/engine/industry.ts` (skilled
  fulfilment gate), the autonomic build planner (value the new building types), and the diffusion/decay
  constants (S5 guardrails).

## Open questions (deferred to per-stage specs)

- **All magnitudes** — labour/space per good, anchor buff + cap, `SKILLED_PER_ACADEMY`, tier-2
  `skilledLabourPerUnit`, decay/diffusion constants. Validated via `npm run simulate` + `audit:economy`,
  cross-checked against the real 10k DB at maturity (~tick 6000).
- **Anchor granularity** — per-good complexes vs per-good-group (e.g. one "Heavy Industry" complex
  buffing the metals chain). Group is fewer building types; per-good is finer specialisation.
- **Academy generality** — one academy type feeding a single skilled pool, vs multiple skill domains.
  Start with one pool.
- **Build-planner valuation of buffs** — how the autonomic planner scores an anchor's yield multiplier
  against plain capacity. Settle in S2.
- **Demand-concentration basis** — what "system character" is computed from (built profile, population,
  tier mix) without re-introducing economy-type tables.
