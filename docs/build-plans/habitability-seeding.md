# Habitability seeding — working file

## Idea

### Problem

The galaxy's habitability mix is inverted from the solar-system shape the game is aiming at:
most systems appear to carry one or more habitable worlds and hardly any dead ones, so early
colonisation offers too many viable targets at once and the map reads unrealistic. Wanted:
usually at most one large habitable world per system (average ≈ Earth), many dead or near-dead
bodies, asteroid belts — with terraforming opening the rest as a later, separate system.

A second problem raised in the same session — nothing paces *when* colonies happen once
charters are affordable — is **split off** to the roadmap row's charter-pricing lever
(distance + concurrent-colony scaling, settled together with player-seat claim pricing).
The two compose; neither replaces the other.

### Chosen direction

**A — retune the existing generation tables, plus one structural gate.**

- Cut habitable archetype weights and raise dead-body weights in the sun-class tables
  (`lib/constants/bodies.ts`).
- Add a per-system soft gate on habitable bodies: 1 is the norm, 2–3 rare, more than 3
  effectively never.
- Retune body size / habitable fraction so the **average** habitable world at full build-out
  holds ~10,000 pops (Earth ≈ 10B people), with a wide spread — rare huge worlds around
  20,000 pops and everything in between. Today size is a flat uniform 0.5–1.5
  (`lib/constants/substrate-gen.ts:9-10`) with no habitability coupling.
- Rename `garden_world` → `temperate`, and add one or two **rare** archetypes as pure table
  rows (a utopia/gaia-type world — very high habitable fraction, low deposits; possibly a
  marginal tundra type). No archetype gets its own behaviour — that surface belongs to the
  future terraforming/technology system.

### Killed alternatives

- **B — structured system templates** (roll a system shape first, then fill it): a new gen
  mechanism; deferred, revisit only if A's measured result still feels wrong.
- **C — gate viability at founding without touching gen**: misreads the complaint — viability
  is a system-level aggregate over all bodies, so dead-heavy systems remain colonisable as
  outposts; the objection is the realism of the mix, not colonisability.

### Premises

**Checkable — become `/measure` claims** (generation census at t=0, whole galaxy; pacing at
both simulate horizons):

1. Most systems carry ≥1 habitable body, and multi-habitable systems are common. (From the
   weight tables: habitable archetypes carry ~44% of per-body roll weight for the two sun
   classes making up 75% of stars, at 2–5 bodies per system — inference, not yet measured.)
2. Most individual habitable worlds contribute little population capacity today: the average
   habitable world's full-build-out popCap sits far below the 10,000-pop Earth anchor.
   (Kai's belief, 2026-08-22 — the measure should confirm it and size the gap.)
3. Early colonisation offers many simultaneously-viable founding targets: count systems
   passing founding eligibility at founding era, and concurrent foundings per faction over
   time at the 10,000-tick horizon.
4. Migration and colonist delivery reach: settlers move along the intra-faction open-edge
   topology; measure how far delivered colonists actually travel today, to judge whether
   sparser habitable systems would strand flows (may need an instrument).

**Definitional — owner decisions, no measurement needed:**

- Average habitable world ≈ 10,000 pops at full build-out; wide spread, rare ~20,000-pop
  giants. Strictly a mean, not a cap. (Kai, 2026-08-22.)
- Up to 3 habitable bodies per system rarely; more than 3 feels unrealistic and is gated out.
  (Kai, 2026-08-22.)
- Barren-but-alive stands: dead worlds keep tiny habitable fractions so they read as mining
  outposts; only pure gas giants are truly uninhabitable. (Roadmap row Don't line, consistent
  with the solar-system framing.)
- Rename `garden_world` → `temperate`; small archetype expansion only, rows-not-mechanics.
  (Kai, 2026-08-22.)
- Concurrency/charter pricing is a separate follow-on pass. (Kai, 2026-08-22.)

**Hypothesis — carried forward, labelled:**

- Fewer, larger habitable worlds slows early expansion without breaking the economy — the
  simulation slows rather than stalls (Kai's read on the roadmap row, 2026-08-12).

### Per-claim falsifiers (committed before any instrument ran)

- **Claim 1** (mix inverted): the terminal falsifier below.
- **Claim 2** (worlds too small): if the mean habitable body's full-build-out popCap —
  `habitableSpace × POP_CENTRE_DENSITY` (20) at housing `spaceCost` 1.0 — reads **≥ 10,000 pops**
  at the t=0 census, the size-retune premise is false.
- **Claim 3** (colonisation bursts): if at the 10,000-tick horizon the median count of
  *concurrent* colony-establish projects per founding faction is **≤ 1**, pacing is already
  gated and the burst claim is false — the motivation falls back to the mix/realism argument
  alone.
- **Claim 4** (delivery reach): descriptive, no kill-line — a reach reading rules nothing out;
  it sizes whether sparser habitables need a migration tweak.

## Evidence (measured 2026-08-22)

Instruments: `temp/habitability-census.ts` (t=0 generation census, 5 seeds × 600 systems,
validated against an analytic expectation derived independently from the weight tables:
measured per-body habitable rate 35.7% vs 35.1% analytic) and one unmodified
`npm run simulate` baseline (`temp/habitability-simulate-baseline.txt`). No tracked code was
instrumented.

### Claim 1 — habitable-bodies-per-system distribution

```
Meaning:  Two-thirds of systems have a habitable world and a third have two or more —
          the mix is habitable-heavy, though "almost every system" was an overstatement.
Claim:    Most systems carry ≥1 habitable body; multi-habitable systems are common.
Number:   ≥1 habitable: 65.7%; ≥2: 31.4% (0: 34.3%, 1: 34.2%, 2: 22.1%, 3: 8.0%, 4: 1.2%, 5: 0.1%)
Horizon:  t=0 generation census (gen-time fact; horizon-independent)
Cohort:   2,900 natural-gen systems over 5 seeds × 600-system preset; 100 prefab capitals excluded
Licenses: Confirms the retune direction (terminal falsifier: <40% any / <10% multi — not met).
          Does NOT say which systems are *viable founding targets* — viability is an aggregate
          over deposits + space, not the habitable flag. The 34.3% zero-habitable cohort is NOT
          "dead": dead archetypes' 2-3% habitable fractions aggregate past the colonisation
          floor, so only 2.5% of systems (≈14.6 per 600, stable across 5 seeds) fall below
          DEVELOP_HABITABLE_FLOOR (habitableSpace < 1, lib/constants/expansion.ts:27) —
          essentially gas-giant-dominated systems. Nearly the whole galaxy is colonisable
          today; the retune moves the habitable-WORLD mix, not colonisability.
```

Raw:

```
0 habitable: 996 systems (34.3%)   1: 993 (34.2%)   2: 641 (22.1%)   3: 232 (8.0%)
4: 35 (1.2%)   5: 3 (0.1%)          ≥1: 65.7%   ≥2: 31.4%
```

### Claim 2 — full-build-out popCap vs the 10,000-pop Earth anchor

```
Meaning:  The average habitable world can hold about a sixth of an Earth even fully built out;
          only prefab capitals reach the anchor today.
Claim:    Most habitable worlds' full-build-out popCap sits far below 10,000 pops.
Number:   Per habitable body: mean 1,719 / median 1,638 / max 4,198 pops.
          Per system (all bodies): mean 1,949 / max 10,845. Capitals: mean 14,150 (prefab).
Horizon:  t=0 census (ceiling is a gen-time fact: habitableSpace × POP_CENTRE_DENSITY 20,
          housing spaceCost 1.0 — lib/constants/industry.ts:179,256-260)
Cohort:   3,126 habitable bodies / 2,900 natural systems / 100 capitals, 5 seeds
Licenses: Confirms the size retune is needed (falsifier ≥10,000 — not met; gap ~6×).
          A ceiling, not an outcome: says nothing about what population is actually reached,
          which staffing, growth and supply gate long before the housing ceiling.
```

### Claim 3 — colonisation pacing at the 10K horizon

```
Meaning:  Colonisation is effectively unpaced — half the galaxy is colonised within ~7 in-world
          years and the money/pool gates almost never bite.
Claim:    Early colonisation runs as a burst with many concurrent foundings per faction.
Number:   292 colonies founded by t=10,000; 267 establishes open CONCURRENTLY at run end
          (~13 per faction across 20 factions); gating split over 55.8K colony-cycles:
          ungated 96.4% (53.8K), funds 3.4% (1.9K), pool 0.2% (96), charter 0.
Horizon:  Both: 1,000t (pre-founding — 0 founded, 48 establishes already open) and 10,000t
          (founding era ≈ year 7; run-end concurrency is censored — still rising).
Cohort:   All 20 factions (8 major + 12 minor), default 600-system preset, harness baseline seed
Licenses: Confirms the burst claim (falsifier: median ≤1 concurrent per faction — not met by
          an order of magnitude). Also supports the split-off concurrency-pricing row: the
          charter gate bit ZERO colony-cycles. Does NOT license tuning any constant against
          these numbers — 10K is founding era, not equilibrium.
```

Raw (10K arm):

```
Founding stock: 292 colonies founded (292 reached a first assessment)
what gated in-flight colonies (55.8K colony-cycles): charter 0 | funds 1.9K | pool 96 | ungated 53.8K
tonnes in the ledgers of 267 open establishes ... peak 267 concurrent
Developed systems | homeworld 20 | colony 292
```

### Claim 4 — colonist delivery reach (descriptive, no kill-line)

```
Meaning:  Delivered colonists travel any distance — delivery ignores topology inside a faction,
          so sparser habitable systems cannot strand the primary colony-populating flow.
Claim:    How far does colonist delivery actually reach?
Number:   n/a — answered by code: allocateColonists pools per faction and water-fills with no
          distance term (lib/engine/colonist-delivery.ts:15-17, documented as deliberate;
          "a topology/blockade-aware routing layer layers on later").
Horizon:  n/a (structural code fact)
Cohort:   n/a
Licenses: Kills the "migration needs adjacency tweaking" worry for THIS change. One-hop
          diffusion stays local, but it is the secondary channel. If a routing layer lands
          later, sparse habitables become its concern, not this retune's.
```

## Scope amendment (2026-08-22, post-spec-review)

Owner decision (Kai): fold the **deposit-space / general-space rationalisation** into this
feature rather than booking it — "Wont we just be tuning it twice if we put it off?" The
archetype tables are the shared surface; a deferred pass would re-open every number this
retune sets. The `### Claim 5 evidence (measured 2026-08-22, instrument `temp/space-utilisation-diag.ts`)

```
Meaning:  The claim's second half is right and its first half is wrong at every measurable
          horizon: deposit-slot caps are unfillably huge (worked counts 1-30 against caps in
          the hundreds), but general space is nowhere near exhausted — the mature cohort uses
          about a third of it.
Claim:    Most developed worlds exhaust general space while most deposit slots sit unworked.
Number:   t=10,000: median developed system general-space use 0.4% (colonies 0.3%, homeworlds
          36.0% p90 47.3%); slots worked median 0.3% (homeworlds 8.9%). Worked extractors per
          resource (homeworlds, t=1000): median 6-18, p90 ≤ 20, max 30 — against slot caps
          median 57-252, p90 up to 489. Composition of USED general space at 10K: housing
          63.1%, factories 29.5%, academies 5.6%, complexes 1.7%, centres 0.1%.
Horizon:  t=1,000 (pre-founding, homeworlds only) and t=10,000 (founding era ≈ year 7).
          NOT equilibrium — colonies are near-empty by construction at this horizon.
Cohort:   All developed systems, split homeworld/colony and habitable-bearing/zero-habitable.
          Validation: 0 general-space overpack violations, 0 slot-cap violations, both samples.
Licenses: FALSIFIES the committed claim (median general use 0.4% < 60%): "general space runs
          out miles before anything else" is not current observed behaviour at any measurable
          horizon — it is a hypothesis about late-game/live-save maturity, and is relabelled
          as one. CONFIRMS decisively that slot caps are meaningless (a 10-30× gap between
          worked counts and caps), which is the deposit-count model's real justification.
          Licenses sizing authored slot counts against worked medians (~5-20 per resource on
          a mature world, max seen 30). Does NOT license any claim about what binds at true
          equilibrium, and does not explain the owner's in-play "worlds out of space"
          experience — candidate explanation, unmeasured: housing is 63-78% of all used
          general space and is bounded by min(habitable, general) remaining, so the binding
          wall a player sees may be HABITABLE space, which this census did not read.
```

### Claims 6-7 (follow-ups to claim 5's falsification; committed before the instrument runs)

**Claim 6 — the wall is habitable space:** on mature systems, housing's use of the habitable
sub-budget runs far ahead of general-space use (habitable utilisation ≫ general utilisation).
*Falsifier:* if homeworld median habitable utilisation is within ~10 points of general
utilisation (no gap), the habitable-wall hypothesis is dead and the owner's in-play
experience needs another explanation.

**Claim 7 — general space tightens at maturity** (descriptive trajectory, no kill-line: 30K
ticks is 3× further out but still short of true equilibrium; the reading shows the trend, and
licenses only a direction, never an equilibrium level).

### Claims 6-7 evidence (measured 2026-08-22, `temp/space-utilisation-diag.ts`, 30K ticks)

```
Meaning:  The habitable-space wall is real but lives on the OPPOSITE cohort from the
          hypothesis: dead-world outposts are pinned against their tiny habitable budgets
          (median 79% used, p90 96%) while their general space sits empty (2%); homeworlds
          show only a small habitable-vs-general gap. And general space never tightens —
          homeworld use plateaus around 39% across 20 in-world years.
Claim 6:  On mature systems, habitable utilisation runs far ahead of general utilisation.
Number:   t=30,000 medians — homeworlds: habitable 43.3% vs general 38.8% (gap 4.5 pts,
          INSIDE the 10-pt kill-line → falsified as committed). Zero-habitable systems:
          habitable 78.9% (p10 35.3% / p90 95.7%) vs general 2.0% — a 77-point gap.
          Habitable-bearing colonies: 4.5% vs 1.3%.
Claim 7:  General-space use trajectory, homeworlds: 36.0% (10K) → 38.4% (20K) → 38.8% (30K).
          Flattening, not tightening. Colonies: 0.3% → 0.9% → 1.4%. Descriptive.
Horizon:  t=1K/10K/20K/30K in one run (30K ≈ in-world year 20; still short of equilibrium).
Cohort:   Developed systems split homeworld/colony and habitable-bearing/zero-habitable.
          Validation: 0 overpack violations, 0 slot-cap violations at every sample.
Licenses: Claim 6 as committed (homeworld-scoped) is FALSIFIED; the same mechanism is
          CONFIRMED on the zero-habitable cohort — the wall players meet is the habitable
          sub-budget on low-habitability worlds, which is ALSO what barren-but-alive intends
          (outposts read small because they are small). Claim 7 licenses "general space is
          not on a path to exhaustion at any measurable horizon" and nothing about true
          equilibrium. Slot-cap meaninglessness re-confirmed at 30K (worked max 36 vs caps
          50-500). The 63-79% housing share of USED space is a share of a nearly-empty
          budget, not of capacity.
```

## Spec` below is therefore superseded pending a rewrite that folds in
(1) the spec review's accepted amendments, (2) sizing decision (b) — pop increase delivered
by shifting the general/deposit split + habitableFraction, size raised only ~1.8× — and
(3) the deposit-space model designed from the measurement below.

### Claim 5 (new checkable premise)

Most developed worlds exhaust (or nearly exhaust) their general space while most of their
deposit slots sit unworked — the binding constraint on a built-out world is general space,
not deposits, and there is no designed relationship between the two.

**Falsifier (committed before the instrument runs):** if at the 10,000-tick horizon the
median developed system uses **less than ~60% of its general space**, or uses **more than
~50% of its deposit slots**, the claim is false — general space is not the binding side (or
deposits are not idle), and the rationalisation goes back to design with that evidence.
Cohorted: read separately for homeworlds and colonies, and by habitable-bearing vs
zero-habitable systems.

**What changes:** Habitable worlds become rare and big instead of common and small. Most systems
are fields of dead rock, ice, gas and asteroids — still colonisable as small outposts — and
roughly a third hold one large habitable world; a second habitable world in the same system is
uncommon, a third is exceptional, a fourth never happens. The average habitable world, fully
built out, can now hold an Earth's worth of people, with rare giants at about double that.
Garden Worlds are renamed Temperate Worlds, and two new world kinds appear: a very rare
paradise world with almost all of its land habitable, and a marginal tundra world.

**Why:** From `## Idea` — the mix is inverted from the solar-system shape the game aims at, and
too many viable targets at once make early colonisation overwhelming (roadmap row 1). Owner
decisions encoded, quoted:
- "up to 3 rarely is acceptable, but any more than that starts to feel really unrealistic"
- "increasing the max size contribution of each world, we want the average to be earth
  equivalent which is 10B people or 10,000pops"
- "the earth anchor is strictly an average, we can have rare huge worlds (20,000pops) and
  everything in between"
- "I would like to rename garden to temperate, and maybe have some kind of utopia type world
  like stellaris. The more variety we have the more interesting it is."
- Barren-but-alive stands (roadmap Don't line; reconfirmed by the solar-system framing — the
  seven dead worlds are outposts, not voids).
- Concurrency/charter pricing split off ("I think for that we need to introduce some kind of
  currency…" — its own pass, composing with this one).

**Evidence** (full frames in `## Evidence` above):
- Claim 1 — two-thirds of systems have a habitable world, a third have 2+. *Licenses the
  retune; does not identify viable founding targets; only 2.5% of systems sit below the
  colonisation floor, so colonisability is near-universal and stays so.*
- Claim 2 — the mean habitable body caps at ~1,719 pops, ~6× under the anchor; capitals ~14,150.
  *Licenses the size retune; a ceiling, not an outcome — says nothing about reached population.*
- Claim 3 — 292 colonies by t=10K, 267 concurrent, 96.4% of colony-cycles ungated. *Licenses
  "the burst is real" and supports the split-off pricing row; licenses no constant tuning.*
- Claim 4 — colonist delivery is distance-agnostic within a faction by code. *Kills the
  adjacency worry for this change.*

**Not claimed:** No terraforming or technology system — nothing here gates anything behind
tech; that remains the row's later half. No change to colonisation pricing, pacing mechanics,
`DEVELOP_HABITABLE_FLOOR`, the prefab homeworld, or migration/delivery routing. No promise
that big worlds *fill* — growth is rate-anchored (~3%/year), so reaching 10,000 pops is a
centuries-scale outcome; the anchor is a capacity definition, not a population forecast. No
economy retune beyond the coarse health bar: deposit-side effects of more bodies per system
are read at calibration, not tuned to a target. A skimmer might read "fewer habitable systems"
as "fewer colonisable systems" — false: the below-floor share stays ~2-3%.

### Behaviour

All generation-time; nothing in the tick changes. Every mechanic below is observable in the
t=0 census (`temp/habitability-census.ts`, promoted or re-run at calibration) and the standard
`npm run simulate` pair.

1. **Per-archetype size bands replace the global size roll.** Today every body rolls uniform
   size 0.5–1.5 from `SUBSTRATE_GEN.SIZE_MIN/MAX` (`lib/engine/body-gen.ts:87`,
   `lib/constants/substrate-gen.ts:9-10`). New: each archetype carries its own `sizeRange`
   (new — read in `rollBody`), habitable kinds rolling large, dead kinds keeping today's band
   so deposit space does not balloon. `SPACE_PER_SIZE` (400) is untouched — it stays the one
   global space anchor.
2. **Habitable-count damping in the archetype roll.** `rollArchetype`
   (`lib/engine/body-gen.ts:70-83`) gains the system's habitable-so-far count: habitable
   archetype weights are multiplied by a damping ladder (new constant, proposed
   `[1, 0.25, 0.05, 0]`) — so a 4th habitable body is impossible by construction, satisfying
   the ≤3 decision as a hard edge, not a tuning outcome.
3. **Weight and body-count retune.** Sun-class `archetypeWeights` shift toward dead bodies and
   `bodyCount` ranges rise (proposal: yellow 4–8, orange 3–7, blue/red 2–5) so a system reads
   as a solar-system-like field. Known side effect, accepted and read at calibration: total
   deposit slots per system rise with body count.
4. **Rename + new archetypes.** `garden_world` → `temperate_world` (id and display name;
   `lib/constants/bodies.ts:26-31`, `lib/types/game.ts:40-41`, prefab reference
   `lib/engine/homeworld-prefab.ts:167`). New rows: `gaia_world` (habitable, very rare, small
   deposit base, habitableFraction ~0.85, largest size band) and `tundra_world` (habitable,
   marginal, habitableFraction ~0.12). Rows only — no archetype-specific behaviour anywhere.
5. **Calibration targets** (defaults set by measurement against the census, definitions above
   set by meaning): ≥1 habitable body in 30–40% of natural systems; ≥2 in 5–10%; exactly 3 in
   ≤1.5%; 4+ never. Mean full-build-out popCap over habitable bodies ≈ 10,000 pops
   (`habitablePotentialPop`, `lib/engine/development.ts:78-81`), p99 approaching ~20,000.
   Below-colonisation-floor share (habitableSpace < 1, `lib/constants/expansion.ts:27`) stays
   ≤ ~3%. Sim health bar (no NaN/runaway/pinning, founding still occurs, dispersion sane) at
   both horizons; conservation identities green.
6. **Save compatibility:** renaming a `BodyArchetypeId` member invalidates existing saves'
   body rows (no load-time guard narrows `bodyType`; `BODY_ARCHETYPES[b.bodyType]` on an old
   id is undefined and crashes read surfaces). Accepted under the pre-1.0 "saves break on
   world-shape change" rule and stated in the PR.

First-cut value tables (proposals with rationale; calibration owns the final numbers):

| Archetype | habitable | habitableFraction | sizeRange | note |
|---|---|---|---|---|
| temperate_world | yes | 0.7 → **0.8** | **[2.5, 4.5]** | mean ≈ 11,200 pops at mean size 3.5 |
| gaia_world (new) | yes | **0.85** | **[3.0, 5.0]** | rare; low deposit weights (biomass/arable/water 2) |
| ocean_world | yes | 0.45 → **0.6** | **[2.0, 4.0]** | mean ≈ 7,200 pops |
| jungle_world | yes | 0.5 → **0.65** | **[2.0, 4.0]** | |
| arid_world | yes | 0.22 | **[1.0, 2.5]** | stays marginal by design |
| tundra_world (new) | yes | **0.12** | [0.8, 1.8] | marginal frontier world |
| volcanic / frozen / barren / asteroid / gas | no | unchanged | [0.5, 1.5] (today's band) | dead-side space and deposits stay put |

### Hazard worksheet

**1. One quantity, several jobs** (impact output in session log; key excerpts):

| Quantity | Readers today | Moved by this design | Intended? |
|---|---|---|---|
| `BODY_ARCHETYPES` | `lib/engine/body-gen.ts` (roll + danger sum), `components/system/system-danger-badge.tsx:30`, `lib/services/universe.ts:103` (display name) | values + one id + two new rows | yes — all three readers deliberately stay coupled; the table is the single source of body identity |
| `SUN_CLASSES` | `lib/engine/body-gen.ts` only | weights + bodyCount | yes, contained |
| `SUBSTRATE_GEN.SIZE_MIN/MAX` | `lib/engine/body-gen.ts:87` only | **retired** in favour of per-archetype `sizeRange` | yes — separation, removes a global knob |
| `habitableSpace` | directed-build (housing fit, colony sizing `:1387,1391`), `development.ts:78-103` (potential pop → development points), `colonisation-value.ts:87,163` (land premium), tick assembly, build-options, services | its *values* shift up on habitable worlds, down galaxy-wide share | yes — every reader is meant to see bigger prime worlds; the field's meaning is unchanged |
| `SPACE_PER_SIZE` | substrate-space partition | **not moved** | deliberate — moving it would rescale deposits too |
| `DEVELOP_HABITABLE_FLOOR` | colony-eligibility `:83`, directed-build `:1387` | **not moved**; below-floor share held ≤ ~3% | deliberate — colonisability is not the lever |

**2. Constants read for their authored meaning:**

| Constant | Docstring says | Used as | Same? |
|---|---|---|---|
| `habitableFraction` | "Fraction of general space that is habitable (supports population centres)" (`bodies.ts:21-22`) | same | yes |
| `SPACE_PER_SIZE` | "Sized so a developed system supports billions of people" (`substrate-gen.ts:17-19`) | left as the global anchor; billions-per-world now realised via size | yes |
| `POP_CENTRE_DENSITY` | "popCap one population-centre building provides. Below a building's labour total by design" (`industry.ts:178`) | ceiling conversion habitableSpace→pops | yes |

**3. Systems sweep:**

| System | Interaction | Reason if none |
|---|---|---|
| Events | none | no event reads bodyType/habitability; `asteroid_strike` is an event id, unrelated to the belt archetype; fewer developed systems just means fewer spawn targets |
| Population + migration | popCap ceilings and headroom shift → attractiveness gradients steepen toward big worlds | — |
| Unrest / regime | indirect only — crowding on big worlds is rate-gated for centuries | — |
| Industry + staffing | bigger habitable worlds carry more general space → more industry land; dead-world extraction stays staffing-bound by tiny habitable fractions (the intended outpost shape) | — |
| Infrastructure decay | none | decays toward use; gen-time values don't enter |
| Directed logistics | outcome-level: sharper specialisation (big habitable importers, dead extractors) → more hauling; read at calibration | — |
| Directed build / planner | colony ROI reordering (land premium on big worlds), housing fit ceilings rise | — |
| Colonisation + founding manifest | candidate mix changes; eligibility mechanics untouched | — |
| Treasury / purse | none | charter formula reads maintenance bill, not substrate |
| Factions + relations | homeworld site-selection bias re-checked at calibration (habitable systems rarer); prefab itself unchanged | — |
| Save format (`World` shape) | shape unchanged; `bodyType` union member renamed → old saves invalid (behaviour §6) | — |
| Harness metrics | every cohort baseline shifts by design; census is the new gen-side metric; conservation identities unaffected | — |

**4. Claims with evidence:** all carried in `## Evidence` (frames with horizon + cohort).

**5. Signals consumed:**

| Consumes | Produced at | Shape today | Design assumes |
|---|---|---|---|
| `habitableSpace` (body/system) | `partitionBody`, `lib/engine/substrate-space.ts:46`; aggregated `body-gen.ts:156` | ≥0, continuous | same, larger on habitable worlds |
| full-build-out potential | `habitablePotentialPop`, `development.ts:78-81` | habitableSpace/spaceCost × 20 | unchanged formula |
| eligibility floor | `colony-eligibility.ts:83` | habitableSpace < 1 → blocked | unchanged |

**6. Aggregates and what else moves them:**

| Metric | Cohort | What else moves it |
|---|---|---|
| habitable-count distribution | natural-gen systems (capitals excluded) | seed (validated stable over 5 seeds); body-count ranges |
| mean habitable popCap ceiling | habitable bodies, natural-gen | archetype mix shift (more tundra drags the mean — read per-archetype too) |
| founding pacing (colonies, concurrency) | per faction, both horizons | charter/pool gates (the split-off row); settler supply |

### Falsifiers (provenance: committed at d572dc8e and e60dc0d2, moved here unedited)

Per-claim falsifiers and the terminal falsifier remain above in this file exactly as
committed; the evidence outcome was **confirmed** on all four claims (correction 0603db9a
narrowed claim 1's licenses only). Post-change acceptance is behaviour §5's calibration
targets, measured with the same census instrument.

### Terminal falsifier

At the t=0 generation census (whole-galaxy cohort, default 600-system preset): if **fewer than
~40% of systems carry any habitable body**, and **systems with 2+ habitable bodies are under
~10%**, then the mix is not inverted, premise 1 is false, and the retune direction dies —
the felt problem would have to be coming from somewhere other than the seeding mix (e.g.
founding eligibility or pacing), and the design restarts from that evidence.
