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
- ~~Barren-but-alive stands~~ **RETIRED by owner decision, 2026-08-23** — see the scope
  amendment below. Original decision kept struck for the record: dead worlds kept tiny
  habitable fractions so they read as mining outposts; only pure gas giants truly
  uninhabitable.
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

## Scope amendment (2026-08-22/23, post-spec-review)

Two owner decisions reshaped the feature after the first spec review:

1. **Fold the deposit-space / general-space rationalisation in** rather than booking it —
   "Wont we just be tuning it twice if we put it off?" (Kai, 2026-08-22). The archetype tables
   are the shared surface; a deferred pass would re-open every number this retune sets.
2. **Retire barren-but-alive** (Kai, 2026-08-23): the measured 78→140 near-empty outpost
   colonies by year 20 are the early-game sprawl the feature exists to cut, and every
   outpost-colonisable dead system is one terraforming cannot meaningfully open later. Dead
   bodies get zero people land; systems without a contributing habitable body are
   uncolonisable until the technology phase. The roadmap row's Don't line is superseded by
   this decision.

The v1 spec was superseded by these plus the review findings; the v2 spec below replaces it
(v1 is in git at 50bd4a0d).

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

### Claim 5 evidence (measured 2026-08-22, instrument `temp/space-utilisation-diag.ts`)

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
          sub-budget on low-habitability worlds. (At the time of this reading that was also
          what barren-but-alive intended; the owner has since retired that principle — the
          outpost sprawl this evidences is part of why.) Claim 7 licenses "general space is
          not on a path to exhaustion at any measurable horizon" and nothing about true
          equilibrium. Slot-cap meaninglessness re-confirmed at 30K (worked max 36 vs caps
          50-500). The 63-79% housing share of USED space is a share of a nearly-empty
          budget, not of capacity.
```

### Comparative research — how the reference games budget land (2026-08-22)

External references are definitional inputs, verified against current wikis (sources in the
session log; stellaris.paradoxwikis.com/Districts, eu5.paradoxwikis.com/Resource_gathering_operation,
vic3.paradoxwikis.com/Building + State).

- **Stellaris**: one shared surface pool — district slots = planet size — that housing (urban),
  industry and resource districts all compete for, PLUS resource districts individually capped
  by small per-planet deposit features, PLUS a separate small building-slot track unlocked by
  urban districts. Habitability is a percentage *multiplier* on pop growth/upkeep, not land.
- **Victoria 3**: explicitly no building slots ("limitations on buildings function in a
  sensible and realistic way"). Agriculture capped by per-state arable land (authored number);
  mines capped by per-state per-resource `capped_resources` (small authored counts); urban
  industry land-UNLIMITED — bounded by population/labour only.
- **EU5**: RGO levels capped per location by a formula growing with population + development
  (base 2); buildings bounded by employment and settlement rank, never by a land budget.

The cross-game pattern, against our three questions:
1. **Extraction**: all three cap it with small authored per-site counts (or a slow
   development-scaled cap). Strongly validates the deposit decoupling — nobody derives slot
   counts from surface area.
2. **People land**: NO reference game has a "habitable subset of shared land" construct.
   Housing either competes in the same pool as industry in discrete legible units (Stellaris)
   or is not land-limited at all (Vic3/EU5 — population binds through other systems). Our
   subset model is the odd one out, confirming the legibility complaint.
3. **Industry land**: Stellaris caps it (planet size); Vic3/EU5 let labour bind instead. Our
   measurement says labour/demand binds miles before land — the Vic3 read.
4. **A trick adopted in v2 as the habitability score/quality layer** (originally noted for
   terraforming): Stellaris expresses marginal worlds through a habitability *multiplier*
   (growth/upkeep penalty), not tiny land.

Verdict: the separation decision stands, reinforced — three independent budgets (people land /
industry land / authored deposit counts) is the closest continuous-space equivalent of what
the reference games do, and the subset construct we are deleting has no precedent in any of
them.

## Spec (v2)

**What changes:** Habitable worlds become rare and big, and a world's nature finally means
something. Each body in a system is a climate class carrying three independent budgets —
people land, industry land, and a handful of authored deposits — plus a habitability score
for the pops that might live there. Only bodies whose score clears a threshold contribute
people land, so a system with no habitable world cannot be colonised at all: the mining
outposts are gone, and roughly a third of the galaxy is settleable until terraforming and
technology open the rest. A colonised system works the deposits on all its bodies — mining
the asteroid belt from the temperate world — at a difficulty set by each body's class, with
hostile classes (volcanic and kin) locked until a future technology. Where a population lives
on mixed worlds, it fills the best land first: a young colony reads its temperate world's
quality, and only as it outgrows that do the marginal worlds drag its growth down. Garden
Worlds are renamed Temperate Worlds; a very rare gaia world and a marginal tundra world join
the roster.

**Why:** the `## Idea` problem plus the scope amendment. Owner decisions encoded, quoted:
- "up to 3 rarely is acceptable, but any more than that starts to feel really unrealistic"
- "we want the average to be earth equivalent which is 10B people or 10,000pops … strictly an
  average, we can have rare huge worlds (20,000pops) and everything in between"
- "rename garden to temperate, and maybe have some kind of utopia type world like stellaris"
- Sizing decision (b): pop capacity delivered by authoring the land budgets directly, not by
  scaling body size (review finding 2 — size scaled deposits identically).
- "Wont we just be tuning it twice if we put it off?" — deposit/general rationalisation folded in.
- "I wonder whether just separating them is just better for clarity for the player" — three
  budgets, dual-use subset retired.
- "Im fine retiring barren-but-alive" — dead bodies carry zero people land; dead systems
  uncolonisable until the technology phase; stations/research posts booked to that phase.
- "allow for different pop types with different habitability preferences … the habitability of
  a body just has to be above a certain threshold which unlocks that bodies habitable land" —
  the score/threshold model; single temperate-preference pop type for now.
- "let's do fill-best-first" — population occupies best-scored land first; quality is computed
  over the occupied prefix.
- "maybe things like volcanic worlds … shouldnt contribute resources to the aggregates until
  certain technologies are unlocked" — per-body lock tags, aggregate recompute on unlock.

**Evidence** (frames above): claims 1-2 license the mix cut and the capacity gap (~6× under
anchor); claim 3 licenses the burst framing; claims 5-7 license the deposit-count model
(worked extractors 1-36 vs caps 50-500), kill the "general space binds" premise, and locate
the habitable wall on the outpost cohort this spec deletes. Each conclusion travels with its
Licenses line; none licenses equilibrium tuning.

**Not claimed:** No technology system ships here — locked bodies and uncolonisable dead
systems are inert content until that phase (stated interim, owner-accepted); no terraforming;
no stations; no second pop type (the preference lookup has one row); habitability quality
feeds GROWTH only — no demand/upkeep coupling this pass (the pricing chokepoint stays
untouched); no charter/concurrency pricing; no per-body population or per-body simulation —
everything per-body resolves at generation, on unlock events, or in one per-cycle quality
fold. Colonisation *pacing* improves only via target scarcity; the money gates stay as
measured (claim 3) until the pricing row.

### Behaviour

**1. The body model.** A body is a climate class (`temperate_world` — renamed from
`garden_world` incl. the prefab literal `lib/engine/homeworld-prefab.ts:167` —, `gaia_world`
(new), `ocean_world`, `jungle_world`, `arid_world`, `tundra_world` (new), `frozen_world`,
`volcanic_world`, `barren_rock`, `asteroid_belt`, `gas_giant`) whose archetype row authors,
per class (all "new — authored in `lib/constants/bodies.ts`", replacing the derived
partition):
- **habitability score** for the default temperate-preference pop type, in [0,1];
- **people land** range (rolled per body; zero on every dead class);
- **industry land** range;
- **deposits**: per-resource authored count ranges (small integers) + the existing quality
  band roll (`rollQualityBand`, `lib/engine/substrate-space.ts:52-58`, kept);
- **extraction work modifier** in (0,1] — how efficiently a colonised system works this
  body's deposits remotely;
- **tech-lock flag** — hostile classes (volcanic at minimum) contribute NO deposits until a
  future technology unlocks them (unlock = re-aggregate; no tick-time reads).
`partitionBody`'s share arithmetic and `SUBSTRATE_GEN.SIZE_MIN/MAX`/`SPACE_PER_SIZE`/
`DEPOSIT_SLOT_FOOTPRINT` are retired on the gen path (verified: SIZE_MIN/MAX has exactly one
reader, `lib/engine/body-gen.ts:87`). Body `size` becomes display flavour derived from the
budgets, not an input.

**2. Aggregation.** System aggregates are built at generation and rebuilt only on an unlock
event:
- **people land** = Σ people land over bodies with `score ≥ HABITABILITY_THRESHOLD` (new
  constant) and not tech-locked;
- **industry land** = Σ industry land over non-locked bodies (dead bodies contribute — a
  colonised system may build on its barren rock);
- **deposits** = per-resource Σ of authored counts over non-locked bodies, each body's
  contribution carrying `count × workModifier` into effective extraction capacity (folds
  where deposit quality already folds — `yieldMult`, `lib/engine/body-gen.ts:117-136` — so
  the tick shape is unchanged).
- Field renames ride the change (name-is-the-bug): `habitableSpace` → people land,
  `generalSpace` → industry land, `slotCap`/`slot*` columns → authored counts, on
  `WorldSystem`/`WorldBody` (`lib/world/types.ts:225-284`) and every reader.

**3. Fill-best-first habitability quality.** Bodies with people land are sorted by score once
at generation. Each population cycle, system quality = the people-land-weighted mean score
over the prefix of that order the current population occupies (housing-equivalent heads:
`population / POP_CENTRE_DENSITY` against cumulative people land). Quality multiplies the
population growth rate (`populationDelta`, `lib/engine/population.ts:445-467`) — growth only,
this pass. A young colony on a mixed system reads its best world's score; overcrowding into
marginal land visibly slows growth. New per-cycle fold in the population processor —
O(bodies-with-people-land) per developed system, no new per-tick state.

**4. Colonisability.** A system is a develop/colonise candidate iff its aggregate people land
holds ≥ 1 housing level (`effectiveSpaceCost(HOUSING_TYPE)`, replacing
`EXPANSION.DEVELOP_HABITABLE_FLOOR` at `lib/services/colony-eligibility.ts:83` and
`lib/engine/directed-build.ts:1387`). Dead systems: zero people land → never eligible.
Claims (`unclaimed → controlled`) remain free and unrestricted — dead systems stay claimable
territory and open logistics corridor (edges open on shared faction, any owned tier). The
colonisable share of the galaxy ≈ the habitable-bearing share (target 30-40%).

**5. Mix targets and the damping ladder.** Sun-class weights shift toward dead classes;
body counts rise (proposal: yellow 4-8, orange 3-7, blue/red 2-5). The habitable-count
damping ladder applies its multiplier BEFORE `rollArchetype`'s `w > 0` candidate filter
(`lib/engine/body-gen.ts:73-74`), clamps beyond its last entry, and requires every sun class
to keep ≥1 positive-weight dead class (unit-tested invariant) — so >3 habitable bodies is
impossible among rolled bodies. Capitals are the stated exception (prefab garden body is
prepended post-roll, `lib/engine/universe-gen.ts:621`) and the census reports them separately.
Ladder values are a calibration OUTPUT constrained by the count targets (review finding 9:
the ≥2 target owns the first damping step; the ≥3/≥4 steps own the cap).

**6. Sizing anchors** (defaults from measurement, definitions from meaning):
- People land: anchor cohort = temperate + gaia + ocean + jungle. Mean full-build-out
  ≈ 10,000 pops (500 land at `POP_CENTRE_DENSITY` 20); gaia tops the spread near ~20,000
  (≈1,000 land, "max habitable-body capacity ≈ 20,000" replaces the unreachable p99 target —
  review finding 8). Arid/tundra are marginal by design, reported but excluded from the
  anchor (review finding 7).
- Deposit counts: authored against claims 5-7 evidence — typical present resource 5-20,
  rich 30-50, poor 2-5 — so a genuinely worked field can approach its cap and "another
  mining world" becomes a real expansion reason.
- Industry land: generous (land is the container, not the contest — labour/logistics bind;
  Vic3 lesson + claims 5/7). A cramped archetype is a deliberate authoring choice, not an
  emergent accident.

**7. Consequential re-anchorings** (each a review finding, each stated here so no reader
meets it as a surprise):
- **Expansion claim scoring** (`lib/engine/expansion.ts:46-52`): the habitable term switches
  to galaxy-max-normalised people land (the same normalisation `placeHomeworlds` already
  uses, `lib/engine/faction-gen.ts:182-186`) so the proximity discount stays live;
  `SCORE_WEIGHTS.diversity` is re-tuned at calibration since the 0-7 diversity count
  saturates at the new body counts. Calibration read: share of claims on zero-people-land
  systems, mean claim hop distance.
- **Colonisation value** (`lib/engine/colonisation-value.ts:150-168, 80-92`): the land term
  and the saturation denominator both re-anchor to people land — `LAND_PREMIUM` scaled down
  by the same ~6× the land scale rose, σ read at calibration with `landGate` distribution.
  `SEED_POP_COST_WEIGHT` was calibrated against the old `LAND_PREMIUM` scale
  (`lib/constants/colonisation.ts:33`) and re-checks with it.
- **Development normaliser** (`lib/engine/development.ts:99-107`; consumers
  `lib/engine/directed-build.ts:610`, `lib/tick/processors/directed-build.ts:532-533` →
  `lib/engine/construction.ts:156-158`): `popRef`/`industryRef` stay galaxy-wide MAXes over
  the new budgets. Under authored land the max is bounded by authorship (gaia system ceiling
  ~20-25K-pop potential vs today's 14,150) — a ~1.5-1.8× popRef rise, not the 3-4× the v1
  sizing implied. DECISION OPEN (owner): accept-and-calibrate (recommended — reads: median/
  p10 systemDevelopment and speculative-build volume, both horizons, vs baseline) or switch
  the refs to a high percentile now.
- **Economy-type labels / event targeting** (`lib/engine/economy-type.ts:20-49`; 11 event
  templates filter on `economyType`, `lib/engine/events.ts:256-257,402-403`; label is
  gen-time-only, `lib/engine/universe-gen.ts:351,633`): the classifier's shares now read
  authored counts × quality. Calibration guard: economy-type histogram over natural systems
  before/after, per-capital labels unchanged, and no class starved to near-zero membership
  (a class with no members silently disables its filtered events).
- **Harness cohorts**: `survival-short` (`lib/tick-harness/cohort-analysis.ts:246`,
  `slotCap.arable ≤ 0`) is re-cut for the new model (candidate: zero-food-capacity among
  COLONISABLE systems) — under the retune the zero-arable share of all systems is a
  majority by design and the old cut stops discriminating. The zero-local-food *colonisable*
  cohort (habitable systems whose deposits lack arable/biomass) is a first-class calibration
  read with food satisfaction and famine/abandonment counts on it (review finding 11 —
  food-import colonies feed the famine gate, `lib/engine/migration.ts:19-21`).
- **Alert bar**: `no_housing_headroom` (`lib/services/alerts.ts:184-188`) reads the people-
  land bound; its meaning narrows to genuinely land-full worlds. Accepted; browser-smoke it.
- **`archetype-weights.test.ts:27-34`** (garden_world largest generalWeight): re-stated for
  the new model — gaia_world holds the top people-land band; the invariant moves there.

**8. Save format and shape.** `SAVE_FORMAT_VERSION` 15 → 16 (`lib/world/save.ts:29`) is
MANDATORY in this PR — the union rename plus field renames make old saves invalid, and the
bump makes them fail cleanly at `deserialiseWorld` (`save.ts:78-83`) per the module contract
(review finding 10). World stays JSON-serialisable; new per-body fields are plain numbers/
booleans.

**9. Surfaces.** Astrography lists each body with class, habitability score, lock state,
deposits and work modifier — the legibility answer; the aggregate stays one number per
budget on Industry. Space tables and build-fit readers move to the renamed budgets
(`lib/engine/build-options.ts`, `lib/engine/directed-build.ts:243-250,1330-1391`,
`components/panels/*`). Migration is untouched — attractiveness reads BUILT `popCap`
(`lib/engine/migration.ts:52,63`), not land (review finding 13; the v1 claim that gradients
"steepen" was wrong and is withdrawn).

### Calibration targets (census `temp/habitability-census.ts` successor + `npm run simulate`,
both horizons, plus the 30K trajectory read where named)

1. Habitable-count distribution (natural-gen, capitals separate): ≥1 in 30-40%, ≥2 in 5-10%,
   =3 ≤1.5%, ≥4 zero across all seeds; read per sun class as well — no class exceeding ~60%
   ≥1-habitable (review finding 12's bimodality guard).
2. People-land anchor: mean full-build-out over the anchor cohort ≈ 10,000 pops; max ≈
   20,000; arid/tundra reported separately.
3. Colonisable share = habitable-bearing share, 30-40%; dead systems 0 people land by
   construction (report any violation).
4. Deposit realism: authored counts within reach of worked counts (a developed system's
   worked/authored ratio can exceed ~0.5 on its main resources at the 30K read).
5. Quality: distribution of system habitability quality at both horizons; homeworlds ≈ 1.0.
6. Economy-type histogram guard; capital labels stable; no starved class.
7. Sim health bar green both horizons (no NaN/runaway/pinning; founding occurs; conservation
   identities pass); colonisation pacing (foundings + concurrency) reported vs claim 3's
   baseline with expected direction DOWN (target scarcity), no numeric target.
8. Development-normaliser reads (if accept-and-calibrate is chosen): median/p10
   systemDevelopment and speculative-build volume vs baseline.

### Falsifiers (provenance)

Claims 1-4 falsifiers: committed at d572dc8e and e60dc0d2, before evidence e618298a; texts
above unedited. Claim 5: committed at 6126c72b before its instrument; falsified honestly
(evidence above). Claims 6-7: committed at 962ad053 before the 30K run; claim 6 falsified
as scoped, mechanism confirmed on the outpost cohort. The v1 spec and its worksheet are in
git at 50bd4a0d; v2's hazard accounting lives in the spec-review report
(`.agent-reviews/spec-habitability-seeding-2026-08-22-120000.md`) plus §7's re-anchoring
list, and is re-verified at the v2 spec review.

### Terminal falsifier

At the t=0 generation census (whole-galaxy cohort, default 600-system preset): if **fewer than
~40% of systems carry any habitable body**, and **systems with 2+ habitable bodies are under
~10%**, then the mix is not inverted, premise 1 is false, and the retune direction dies —
the felt problem would have to be coming from somewhere other than the seeding mix (e.g.
founding eligibility or pacing), and the design restarts from that evidence.
