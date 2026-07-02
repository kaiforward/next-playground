# Economy Specialisation — Forced Trade Gradients via Industry Differentiation

> **Status:** Track designed 2026-06-30 (brainstorm); **stages S1 (skill-tiered labour), S2
> (specialisation complexes) and S3 (development-tiered demand) shipped** — as-built functional specs live in
> [economy-specialisation.md (active)](../active/gameplay/economy-specialisation.md),
> [economy-specialisation-s2-complexes.md (active)](../active/gameplay/economy-specialisation-s2-complexes.md) and
> [economy-specialisation-s3-demand.md (active)](../active/gameplay/economy-specialisation-s3-demand.md).
> Stage **S4 remains planned.** Sits inside **SP5 autonomic-light**, and **expands the roadmap's narrow "2a — preserve a
> spread" item** (in [economy-scaling-and-trade-rework.md](./economy-scaling-and-trade-rework.md)) from
> "build/decay pacing" into a real structural-specialisation track. Decomposes into **four** ordered
> stages, each its own spec → plan → build. Authoritative sequence in
> [economy-simulation-vision.md](./economy-simulation-vision.md) §13.

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

- **Skill-tiered labour vector** — a good's `labourPerUnit` becomes a per-good 3-vector
  `(unskilled, skill1, skill2)` that *partitions* its head count (it does not add to it). Advanced
  manufacturing is both labour-intensive *and* skill-intensive; extraction/automated processing is light
  and unskilled. *(Folds three earlier levers into one model, co-built and co-calibrated in S1: "tier-scaled
  labour" + "per-good labour" + the standalone "skilled labour" stage. Per-good subsumes tier-scaling; the
  skill partition + academy gates subsume the separate skilled-labour stage — see
  [the merged factor model](#skill-tiered-labour-the-merged-factor-model). The "scalar-proxy" skilled
  stopgap once floated is dropped.)*
- **Per-good space cost** — `spaceCost` varies by good. Shipyards/foundries are *enormous*; a gas
  harvester is sparse. You physically can't fit the whole tier-2 basket on one body. *(Scope: this
  differentiates **general-space** footprints — tier-1/2 factories + housing, the land industry and
  population compete for. Tier-0 extractor footprint stays on the deposit-slot model
  (`DEPOSIT_SLOT_FOOTPRINT`); making deposit footprints per-good is a deeper substrate change, out of
  S1.)*
- **Specialisation complexes** (anchor buildings) — *see [its section](#specialisation-complexes-anchor-buildings)*.
  *(This is the chosen lever for manufacturing comparative advantage. It supersedes two earlier ideas:
  (a) **trait affinity for tier-1 goods** — dropped, because no physical trait sensibly "makes
  electronics better"; and (b) **continuous economies-of-scale** — the anchor IS economies-of-scale, done
  as a discrete, hard-capped, self-limiting building rather than a runaway-prone marginal-efficiency
  curve. We build the anchor, not the continuous version.)*

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

## Skill-tiered labour (the merged factor model)

> **This is S1 — ✅ shipped.** The as-built functional spec lives in
> [economy-specialisation.md (active)](../active/gameplay/economy-specialisation.md); this section is kept as
> the design rationale. It folds together what were three separate levers — per-good labour, per-good space, and
> the standalone skilled-labour stage — because they are **the same factor equation** and must be
> calibrated as one. Shipping per-good labour first and *then* layering skilled gates on would re-derive
> every staffing number and rebuild the labour model from scalar into vector; merging avoids that churn.
> The magnitudes here are coarse first-cut anyway — the real calibration is **one pass once the whole
> structural track is in**, per the coarse-health-calibration principle. Numbers are perishable; the
> *structure* is what we're committing to.

**Labour is a per-good 3-vector that partitions the head count.** A good's staffing requirement is split
across skill grades — it is *not* topped up with extra heads. A 1000-head fab is 1000 people composed as
(say) 600 unskilled / 300 technicians / 100 engineers, not 1000 + 300 + 100:

- **Tier-0** (extraction / automated processing) — unskilled only.
- **Tier-1** (basic manufacturing) — mostly unskilled + a technician (skill-1) share.
- **Tier-2** (advanced manufacturing) — unskilled + technicians (skill-1) + engineers (skill-2).

Population stays a **single scalar** (the vision §4 keystone — population is a magnitude, not a roster of
people). Skill is **not** a kind of person; two **academy buildings** raise a *ceiling* on how much of the
existing labour may perform at each grade.

```
// per good, labour PARTITIONS the head count (the three shares sum to the total):
labour_b = (unskilled_b, skill1_b, skill2_b),   Σ = labourPerUnit_b

// 1. Headcount gate — ONE aggregate gate. The bodies must physically exist.
labourDemand = Σ count_b × labourPerUnit_b            // = Σ over every good's full vector
labourFulfil = min(1, population / labourDemand)      // UNCHANGED from the scalar model

// 2. Skill-ceiling gates — per level. Academies license how much labour may work at each grade.
skill1Demand = Σ count_b × skill1_b
skill2Demand = Σ count_b × skill2_b
skill1Cap    = Σ vocationalSchools  × SKILL1_PER_SCHOOL      // "this much technician-grade work is licensed"
skill2Cap    = Σ researchInstitutes × SKILL2_PER_INSTITUTE   // "this much engineer-grade work is licensed"
skill1Fulfil = min(1, skill1Cap / skill1Demand)
skill2Fulfil = min(1, skill2Cap / skill2Demand)

// each good is gated by ALL pools it draws on:
output_b = count × outputPerUnit × min(labourFulfil, skill1Fulfil?, skill2Fulfil?) × yield × anchorBuff
//   tier-0: labourFulfil only  |  tier-1: + skill1Fulfil  |  tier-2: + skill1Fulfil + skill2Fulfil
```

**Two academy buildings, one per grade** — a **vocational school** (licenses skill-1) and a **research
institute** (licenses skill-2). Each is a building: it eats general space and draws *unskilled* headcount
to run (adds to `labourDemand`), and it raises its pool's ceiling. They do **not** require skilled labour
to staff — otherwise you'd need an academy to staff an academy. Instructors are abstracted into the
licensing function. (One academy type per grade; no finer split — there isn't a more interesting cut.)

**Academies decay toward skill demand.** Like every building, an academy rots toward what it actually
serves: its `used = count × min(1, skillDemand / skillCap)` (skill-1 demand for a vocational school,
skill-2 for a research institute). An academy licensing more skilled work than the system demands sheds
the excess; one orphaned by a contracted hub (`skillDemand → 0`) decays away entirely. Same single decay
rule as production and housing — it keeps academies concentrated at genuine hubs and reinforces the
concentration moat.

**The development ladder falls out for free.** Because tier-2 goods draw skill-1 labour too (a fab needs
technicians, not just engineers), a system cannot run tier-2 without *both* a research institute and the
vocational capacity its technician share demands. No explicit "institute requires school" prerequisite is
needed — the ladder emerges from the partition. A frontier world with population and space but **no
academies** has `skill1Fulfil = skill2Fulfil = 0` → it physically cannot run manufacturing, no matter how
big it grows. Becoming a tech hub costs space + pop on *both* academy tiers *and* the labs → you can't also
be broad → you import the rest.

### Build-planner valuation — the academy as a buildable labour gate

The autonomic build planner (`lib/engine/directed-build.ts`) only builds capacity that serves a *reachable
structural deficit of a good*, gated by `min(space, served-demand, budget, labour)`. An academy produces no
good, so under the planner as-is it would **never be built** — and the skill gates would then silently
suppress tier-1/tier-2 *everywhere* (every world becomes a frontier world). So the academy needs a valuation.

The fix is that **the skilled gate is a *buildable* labour gate.** The planner already caps a build by spare
labour; the only difference is that when *labour* binds you cannot fix it (you cannot manufacture people),
but when a *skill ceiling* binds you can — build an academy. So:

- When the industry pass commits to a skill-gated good to serve a deficit and the skill ceiling is the
  binding cap, it **builds the academies needed to lift that ceiling first, charged to the same
  opportunity** — spending budget + space + the academies' own unskilled staffing — then builds the
  production with what's left.
- The academy is therefore valued **transitively**: its worth is exactly the suppressed deficit-serving
  output it unblocks. This preserves the planner's invariant (every build traces to a reachable structural
  deficit) — **no speculative academies**.
- It **self-paces across cycles**: the per-cycle build budget naturally splits between academies and
  factories, and the working-copy mutation means once an institute is up, the next skill-good opportunity
  at that site sees the raised ceiling.

*Not a proactive academy pass (like housing).* Housing is proactive because population is a slow logistic
you must lead — build ahead and bet the people come. Academy demand isn't speculative; it *is* the deficit,
already known. A proactive pass would build institutes at systems that may never use them and need its own
gate that just re-derives the deficit reasoning the industry pass already has. Demand-pulled co-build is
strictly better.

**Concentration moat (coarse-calibration, not core mechanic).** Opportunities rank by `served ÷ route
cost`. A skilled build that *also* needs new institutes is genuinely more expensive than an unskilled one
serving the same deficit; folding that overhead into the score lets a system that **already paid** the
academy cost out-compete a greenfield one. Skilled industry then *concentrates* at systems that sank the
cost — the academy sunk-cost becomes a comparative-advantage moat that stacks with S2's anchor space-cap
moat. The system that has paid for institutes *and* an electronics complex becomes *the* regional
electronics hub and physically can't also be broad. That's the specialisation the track is chasing, falling
out of the planner mechanics — but it's a scoring refinement to settle during calibration, not the core.

**Demographic skilled labour stays a deferred alternative, not superseded.** The labour vector here is
*per-good* (each good's staffing requirement is split across grades); **population itself stays one
scalar** — don't conflate the two vectors. Modelling skill as a *kind of person* (population becomes a
vector; skilled workers **migrate to jobs**) is evocative but fights the vision's §4 keystone (population
is a scaled magnitude, not individuals) and touches every pop subsystem. The infrastructural model is a
**different, self-consistent endpoint** — *not* a worse version of demographic — and skilled-migration can
layer on later as its own feature if we ever want it. Decision deferred deliberately; infrastructural ships
now.

## Staged decomposition

Each stage is its own spec → plan → build, ordered for reviewability. All agency-free. The guardrails
stage is **last** so we tune diffusion/decay against the *real* gradient the structural stages create
(the roadmap's original "2a build/decay pacing" is folded into S4).

| Stage | Lever(s) | Failure mode | Needs agency? |
|---|---|---|---|
| **S1 ✅ shipped** | **Skill-tiered labour vector** (per-good unskilled+skill1+skill2) + **per-good space** + **academies** (vocational school + research institute) + amplify input-demand magnitude | Breadth (factor scarcity + development endowment gate) | No |
| **S2 ✅ shipped** | **Specialisation complexes** (manufacturing CA + economies-of-scale) — spec: [economy-specialisation-s2-complexes.md](../active/gameplay/economy-specialisation-s2-complexes.md) | Breadth (comparative advantage) | No |
| **S3 ✅ shipped** | **Development-tiered civilian demand** (skilled-work share shifts the basket up-tier) — spec: [economy-specialisation-s3-demand.md](../active/gameplay/economy-specialisation-s3-demand.md) | Flat demand | No |
| **S4** | **Guardrails & tuning** — build-pacing, tier-scaled decay, diffusion friction | Volume + Diffusion | No |

> **Interstitial — Economy UI legibility (quick wins), between S1 and S2.** S1 made the mechanics deep
> (skill tiers, academy licensing, per-good labour composition) but the Industry/system screens still show
> numbers without the *why*. Before S2, a focused UI pass: surface the **system's skilled-labour pools**
> (skill-1/skill-2 supply vs demand), each factory's **staffing usage** (which pool is binding — the data is
> already in `buildIndustryReadout` via `effectiveFulfilment`/`idleReason`), and **short "what it does"
> descriptions** for buildings, especially academies. Reuses the existing `Tooltip`. The ambitious
> **Paradox-style nested/pinnable deep-tooltip system** (rich-tooltip infra + a cross-linking concept
> glossary) is a SEPARATE, larger project deferred until after the full sX economy track. Both get a
> collaborative HTML-prototype design pass before build. Tracked in `docs/BACKLOG.md`.

> **S1 absorbs the old standalone "skilled labour" stage** (was S3). Per-good labour, per-good space, and
> skilled labour are the same factor equation and must be calibrated jointly — see
> [the merged factor model](#skill-tiered-labour-the-merged-factor-model). Splitting them would re-derive
> every staffing number when the skill gates land. The build *can* still ship as 2 reviewable PRs inside
> S1 (the labour vector + per-good costs, then the academies + live gates), with the single coarse
> calibration run after both.

First-cut shape (first-draft, simulator-calibrated — only relative shape matters):

- **Labour vector:** tier-0 light + all-unskilled; tier-2 heavy across all three grades (e.g. total head
  count ~10 → ~25 → ~60, with the skill1/skill2 shares rising by tier). Per-good within tier where it reads
  true (labour-heavy textiles/consumer-goods/luxuries vs automated refining).
- **Space:** extraction/processing modest; the most-integrated tier-2 (shipyards, foundries) large.
- **Skilled:** `SKILL1_PER_SCHOOL`, `SKILL2_PER_INSTITUTE`, and the per-good skill shares set so a tech hub
  needs a real academy investment a frontier world can't casually match.
- **Anchor buff & cap (S2):** a meaningful multiplier (enough to make concentration clearly worth the
  space), cap 1–2 per system.

**Genuinely deferred (downstream — this track feeds them, unchanged in sequence):** full faction agency
(treasury / doctrine-weighted build / directed-logistics orders), the contract-model rework, ship
re-pricing, events, war. None of the near-term stages is a worse-version of these — they're different
layers that sit on the gradient we're building. Demographic skilled labour and continuous
economies-of-scale are captured above as explicitly-not-now.

## S2 first-cut findings — 2026-07-02 sim (calibration inputs)

First structural validation of the S2 complexes against the pre-complex baseline
(`infra-trajectory-*`, 600 systems, seed 42, no overrides). **The structure works; the
magnitudes are too weak — concrete inputs for the joint S1–S4 calibration pass:**

**It arrests the maturity-flattening (the whole point of the track).** The baseline spread
flattens as the galaxy matures (price/base p90 1.91→1.70, expensive-fraction 41.5%→37.0%
from 4000→8000 ticks). With complexes the mature (8000-tick) spread holds wider — p90
**1.79**, expensive **39%**, median 1.00 (vs 0.98), less universal glut (cheap 38.7%→36%).
The effect is ~nil at 4000 ticks and clear at 8000 — it *grows* with maturity, as intended.

**Systems do specialise, but only where a complex anchors, and only modestly.** Measuring
complex-holders' avg family throughput ÷ all-systems' avg (t=0 seed → t=8000 final):
- **Heavy Industry** (11→13 complexes): ratio 2.7×→**3.5×** — the emergent snowball fires
  (holders concentrate harder, galaxy average *falls*, +2 complexes self-build over the run).
- **Chemicals** (15→16): 2.3×→2.4× — flat (holders and galaxy grow ~together).
- **Electronics / Armaments**: **never anchor** (0 complexes — no system clears
  `ANCHOR_MIN_THROUGHPUT`), and they *de-concentrate* over time (top-5% share 83%→40%,
  57%→41%). Un-anchored families spreading out is the counterfactual that proves the anchor
  is what holds concentration.

**Calibration levers this surfaces (record for the joint pass — do NOT tune in isolation):**
1. **`ANCHOR_MIN_THROUGHPUT` is too high.** Electronics/armaments are naturally niche
   (already the most concentrated goods) yet never clear the floor, so the one lever meant to
   anchor them never fires. Lower it, or make it *per-family / relative to the family's
   galaxy-wide throughput* rather than an absolute (`scaleValue(10)`).
2. **Buff (`buffMult` 1.4–1.5) and/or footprint too small for a strong snowball.** Seeded
   complexes come out fractional (0.01–0.31 units) because the seeder charges them to the
   *leftover* factory budget after factories + academies, so the yield lift — and the
   build-planner snowball it drives — is shallow. Strengthen the buff and/or the seed/build
   sizing so a complex is a decisive, mostly-whole commitment.
3. **Complex drifts off its family.** Dominant-family match falls (Heavy 100%→85%, Chem
   100%→69%) as the world evolves around a once-placed complex. Acceptable, but confirm the
   decay-toward-throughput actually rots genuinely-orphaned complexes (appears to; not
   separately measured).

Health held throughout (greedy ≫ random, no NaN/runaway). Single-seed deterministic A/B —
directional evidence, not multi-seed robustness. Raw runs saved to
`experiments/s2-complexes-{4000,8000}-*.json` (git-ignored).

## S3 first-cut findings — 2026-07-02 sim (calibration inputs)

Structural validation of development-tiered civilian demand against the S2 baseline
(`s2-complexes-*`, 600 systems, seed 42, no overrides — S3 runs saved as
`experiments/s3-demand-{4000,8000}-*.json`, git-ignored). **The demand side now does what the
supply side (S2) does: it concentrates at developed systems, and the two stack — concrete
inputs for the joint S1–S4 calibration pass:**

**It widens the spread further, at both ages.** On top of S2's arrest of the maturity-flattening,
S3 pushes the spread out: 4000 ticks p90 1.93→**2.11**, expensive 41.2%→**45.6%**; mature 8000
ticks p90 1.79→**1.97**, expensive 39.4%→**43.5%**, median 1.00→1.03, cheap 36.5%→34.3%. Every
discretionary good's cross-system price dispersion rises (8000t avgStdDev: luxuries 81.8→86.5,
consumer_goods 20.5→24.7, electronics 48.4→51.4, medicine 32.4→34.9, textiles 11.3→13.0). Bots
get richer on the extra structure (optimal 3.87M→5.01M, greedy 2.37M→2.89M) with health intact.

**Discretionary prices do track skilled work — where hubs can't self-supply.** At t=8000
(12.5K technician + 3.6K engineer heads worked galaxy-wide; top-5% hubs vs 187 zero-skill
frontier systems):
- **Luxuries is the flagship**: corr(skilled, price/base) 0.26; hubs average **1.69×** base vs
  frontier 1.25×, and hubs are **net importers** (top-20 skilled systems: production 19.3 vs
  civilian draw 25.2, 11/20 in deficit). The engineer-exclusive good becomes the import magnet
  the spec wanted — dear exactly where the engineers are.
- **Textiles** mirrors it (corr 0.26; hub 1.42× vs frontier 0.95×) — a tier-0 good hubs don't
  bother producing.
- **Consumer goods / medicine** correlate weakly (0.17 / 0.02) because hubs largely self-supply
  them (net +30.9 / +15.6 across the top 20) — the industry that employs the skilled heads also
  feeds their basket. Demand and supply co-locate, so the signal shows up as volume, not price.
- **Electronics is fully washed out** (corr 0.02, hub 1.56× = frontier 1.56×): it is
  simultaneously the archetypal hub *product* and a basket good. Expected, not a defect.

**Electronics nearly anchors now — the S2 lever is confirmed and quantified.** S2 found
electronics/armaments never clear `ANCHOR_MIN_THROUGHPUT` (10). With S3's extra electronics
demand pulling production up, the top electronics system reaches throughput **9.75** — a
whisker under the floor (armaments top 6.39; both still 0 complexes at t=8000). The S2
calibration lever ("floor too high / make it per-family") now has a magnitude: electronics
needs only a ~3% lower floor (or any buff/coeff nudge) to start anchoring, and S3-side basket
weights push in the same direction. Do this in the joint pass, not in isolation.

**Calibration levers this surfaces (for the joint S1–S4 pass):**
1. **Basket sizing is directionally right, modest in magnitude.** Hub discretionary premiums
   are ~1.3-1.7× where visible; the skilled population share came out ~20% technicians / ~6%
   engineers of total population (comment targeted ~15%/4% at mature hubs) — recheck the
   per-head needs against the realised share when tuning.
2. **Luxuries works as designed; consider whether consumer_goods should stay hub-self-suppliable.**
   If the calibration pass wants more demand-led trade, shifting basket weight toward goods hubs
   *don't* make (or raising luxuries' weight) buys more than raising self-supplied baskets.
3. **Electronics anchor floor** — see above; one small nudge away from firing.

Health held throughout (greedy ≫ random — 2.89M vs 120 at 8000t; no NaN/runaway; floor/ceiling
pins comparable to baseline). Single-seed deterministic A/B — directional evidence, not
multi-seed robustness.

## Relationship to existing docs

- **[economy-scaling-and-trade-rework.md](./economy-scaling-and-trade-rework.md)** — this **expands its
  "2a — preserve a spread" item** from build/decay pacing into the full structural track. The contract-model
  rework (its sub-project 3) depends on the spread this track creates.
- **[economy-simulation-vision.md](./economy-simulation-vision.md)** — realises §8 (build space, the
  industrialize-vs-feed pull) and §11 (regional specialisation, need-cascades) at the baseline level, and
  pre-builds the substrate full faction agency (§12) will later *decide* over.
- **[negative-space-economy.md](./negative-space-economy.md)** — refined: negative space = locally-unmet
  demand, produced by forced specialisation, not a flat over-supplied world.
- **Live code touched:** `lib/constants/industry.ts` (per-good labour **vector** + space, vocational-school
  + research-institute + anchor building types), `lib/engine/industry.ts` (`skill1Fulfil`/`skill2Fulfil`
  gates folded into `buildingProduction`), `lib/engine/directed-build.ts` (the autonomic build planner —
  academy as a buildable labour gate, transitively co-built against the deficit it unblocks),
  `lib/engine/industry-seed.ts` (seed academies sized to seeded skill demand so seeded tier-1/2 can run),
  `lib/engine/infrastructure-decay.ts` (academy decay toward skill demand, S1),
  `lib/constants/physical-economy.ts` (demand concentration, S3), and the diffusion/decay constants
  (S4 guardrails).

## Open questions (deferred to per-stage specs)

- **All magnitudes** — per-good labour vector (the unskilled/skill1/skill2 shares) + space, anchor buff +
  cap, `SKILL1_PER_SCHOOL` / `SKILL2_PER_INSTITUTE`, decay/diffusion constants. Coarse first-cut now;
  validated via `npm run simulate` + `audit:economy` and cross-checked against the real 10k DB at maturity
  (~tick 6000) in one calibration pass once the structural track is in.
- **Per-good skill shares** — how each tier-1/tier-2 good's head count splits across grades. Coarse by tier
  to start, refined per-good only where it reads true (a fab is engineer-heavy; a textile mill
  technician-light).
- **Anchor granularity** — per-good complexes vs per-good-group (e.g. one "Heavy Industry" complex
  buffing the metals chain). Group is fewer building types; per-good is finer specialisation. (S2.)
- **Anchor buff valuation** — how the autonomic planner scores an anchor's yield multiplier against plain
  capacity. Settle in S2. *(The academy's valuation is already settled — see
  [the merged factor model](#skill-tiered-labour-the-merged-factor-model): a buildable labour gate,
  transitively co-built. The open piece is whether to fold the academy's build overhead into opportunity
  scoring for the concentration moat, or leave that to calibration.)*
- ~~**Demand-concentration basis**~~ — RESOLVED 2026-07-02: skilled work *performed*
  (`computeLabourAllocation` technicians/engineers), per-grade additive baskets. Not the built
  production profile — pops don't consume more of what their system makes; the built-profile→demand
  link is the (existing) industrial input-demand channel. See
  [economy-specialisation-s3-demand.md](../active/gameplay/economy-specialisation-s3-demand.md).
