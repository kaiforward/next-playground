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

## Spec (v2.1 — v2 amended with the second review's triage, all findings called 2026-08-23)

**What changes:** Habitable worlds become rare and big, and a world's nature finally means
something. Each body is a climate class carrying three independent budgets — people land,
industry land, and a handful of authored deposits — plus a habitability score per pop type.
Only bodies whose score clears the default pop type's threshold contribute people land, so
roughly a third of systems are settleable at start; hot and cold marginal worlds (arid,
tundra) sit below the default threshold and wait for terraforming or for future pop types
whose preferences favour them — blue-white and red-dwarf systems (25% of stars) are
deliberately uncolonisable until then. A colonised system works the deposits on all its
bodies at a per-body difficulty, with hostile classes locked until a future technology.
Population fills the best land first: a young colony reads its best world's quality, and
quality — which multiplies growth — drifts down as settlement overflows onto worse land.
Systems that decline to empty now genuinely end, famine or no famine. Garden Worlds become
Temperate Worlds; gaia, boreal and tundra worlds join the roster.

**Why:** the `## Idea` problem plus the scope amendment. Owner decisions encoded, quoted:
- "up to 3 rarely is acceptable, but any more than that starts to feel really unrealistic"
- "the average to be earth equivalent which is 10B people or 10,000pops … strictly an
  average, we can have rare huge worlds (20,000pops)"
- Sizing decision (b): capacity delivered by authoring budgets directly, never by body size.
- "Wont we just be tuning it twice if we put it off?" — deposit rationalisation folded in.
- "I wonder whether just separating them is just better for clarity" — three budgets.
- "Im fine retiring barren-but-alive" — dead bodies carry zero people land.
- "the habitability of a body just has to be above a certain threshold which unlocks that
  bodies habitable land" + "let's do fill-best-first" — the score/threshold/quality model.
- "we want asymmetry here more than homogenous" (2026-08-23) — arid/tundra score BELOW the
  default threshold; each future pop type sees its own ~25-50% slice of the galaxy.
- "temperate preference really only gets 100% on temperate … ocean … more like 50-75%" —
  the score spread below; boreal added to even the freezing→volcanic spectrum.
- Hard-world failure (2026-08-23): decline-to-empty ENDS — abandonment fires on population
  < 1 regardless of famine (option c).
- Events: "let's just leave events as is and we'll revisit and do the split properly" —
  coverage dilution accepted, events-revisit row booked.
- Development normaliser: "accept and calibrate".
- Capitals: mid-sized is fine — "it doesnt necesarilly have to be the biggest worlds".

**Evidence** (frames above): claims 1-2 license the mix cut and capacity gap (~6× under
anchor); claim 3 the burst framing; claims 5-7 the deposit-count model (worked 1-36 vs caps
50-500), the death of the "general space binds" premise, and the outpost-wall cohort this
spec deletes. Each conclusion travels with its Licenses line; none licenses equilibrium
tuning.

**Not claimed:** No technology system (locked bodies, uncolonisable dead systems and stale
`economyType` labels are stated interim); no terraforming; no stations; no second pop type
(the preference lookup ships with one row); quality feeds GROWTH only — no demand/upkeep
coupling; no charter/concurrency pricing; no per-body population or per-tick per-body work —
everything per-body resolves at generation, on unlock, or in one per-cycle quality fold.
The felt event rate per developed system drops ~2.5× with the colonisable-share cut
(`maxEventsGlobal = totalSystems × EVENT_COVERAGE_TARGET`, `lib/constants/events.ts:89-96`,
spawns galaxy-wide while effects land on developed systems only) — accepted this pass,
booked to the events-revisit roadmap row. Colonisation pacing improves only via target
scarcity; money gates stay as measured until the pricing row.

### Behaviour

**1. The body model.** A body is a climate class on a freezing→volcanic spectrum:
`frozen_world` · `tundra_world` (new) · `boreal_world` (new) · `ocean_world` ·
`temperate_world` (renamed from `garden_world`, incl. the prefab literal
`lib/engine/homeworld-prefab.ts:167`) · `gaia_world` (new) · `jungle_world` · `arid_world` ·
`volcanic_world`, plus athermal `barren_rock` · `asteroid_belt` · `gas_giant`. Each archetype
row authors (new — `lib/constants/bodies.ts`, replacing the derived partition):
- **habitability scores** — one column per pop type; ships with the default
  temperate-preference column and `HABITABILITY_THRESHOLD = 0.5` (new constants):

  | class | score (default pop) | contributes people land? |
  |---|---|---|
  | temperate_world | 1.0 | yes — the only 100% |
  | gaia_world | 1.0 | yes (its edge is more land, never a >1 score) |
  | jungle_world | 0.7 | yes |
  | ocean_world | 0.65 | yes |
  | boreal_world | 0.6 | yes |
  | arid_world | 0.35 | no — hot-preference / terraforming territory |
  | tundra_world | 0.3 | no — cold-preference / terraforming territory |
  | frozen_world / volcanic_world / barren_rock / asteroid_belt | 0.1 / 0.05 / 0.05 / 0.02 | no |
  | gas_giant | 0 | no |

- **people land** range — authored on every class that could ever host people: arid/tundra
  CARRY people land that only an adapted pop type or terraforming can use (it exists, dark,
  per the threshold model); truly dead classes author zero;
- **industry land** range (first-cut bands ~40-300 by class, calibration-owned; a numeric
  galaxy max is stated when the table is filled — it feeds `industryRef`);
- **deposits**: per-resource authored count ranges + the kept quality-band roll
  (`rollQualityBand`, `lib/engine/substrate-space.ts:52-58`);
- **extraction work modifier** in (0,1] — kept as its OWN per-system aggregate
  `extractionEfficiency[r]` (deposit-count-weighted mean over contributing bodies), NEVER
  folded into `yieldMult`, whose authored meaning (pure ground grade,
  `lib/engine/body-gen.ts:46-54` — the fold itself is `depositGradeVector` at
  `body-gen.ts:158`) and UI band labels stay intact. Extraction output = count × yieldMult ×
  extractionEfficiency. Counts stay integers. Because extractors are a per-system pool with
  no body attribution, Astrography's per-body modifier is a contribution weight to the
  system's effective yield, not the yield of an extractor placed there — stated in the UI.
- **tech-lock flag** — hostile classes contribute NO deposits until a future technology
  (unlock = re-aggregate; locks only release; `economyType` is NOT re-derived on unlock
  (written only at `lib/engine/universe-gen.ts:351,633`) — stale label + event-targeting
  accepted `[PENDING: technology]`).
The per-archetype/per-body `habitable: boolean` is DELETED (a second, disagreeing answer to
the score); `body-card.tsx`, `lib/services/universe.ts:104`, `lib/types/api.ts:253`,
`lib/world/gen.ts:153` move to score band + lock state. `partitionBody`'s share arithmetic
and `SUBSTRATE_GEN.SIZE_MIN/MAX` (single reader verified, `body-gen.ts:87`) are retired.
Body `size` becomes display flavour. `SPACE_PER_SIZE` dies with the partition;
`DEPOSIT_SLOT_FOOTPRINT` survives ONLY as the explicit deposit→land unit inside
`industryPotential`/`systemDevelopment` (see §7) and is re-authored against the count scale.

**2. Aggregation and the build rule.** Aggregates build at generation, rebuild on unlock:
- **people land** = Σ over bodies with default-pop score ≥ threshold and unlocked;
- **industry land** = Σ over unlocked bodies (dead bodies contribute — factories on the
  barren rock);
- **deposits** = per-resource Σ authored counts over unlocked bodies, with
  `extractionEfficiency[r]` alongside.
**The build rule (the separation made operational): housing bills to people land ONLY;
factories, academies, complexes and centres bill to industry land ONLY; extractors bill to
neither.** `generalSpaceUsed` (`lib/engine/industry.ts:329-337`) becomes `industryLandUsed`
and stops counting housing; `habitableHousingHeadroom` (`lib/engine/directed-build.ts:243-250`)
drops its `min(…, remainingGeneral)` and returns the people-land bound alone — housing and
industry no longer compete anywhere. All six readers migrate:
`build-options.ts:77,95`, `directed-build.ts:247,564,1005`, `construction-centre.ts:86`, and
`development.ts:132`, whose manual `− housingSpace` net-out is deleted as redundant.
Field renames ride the change: `habitableSpace` → people land, `generalSpace` → industry
land, `slot*` columns → authored counts (`lib/world/types.ts:225-284` and every reader).
`availableSpace` is DELETED from `WorldSystem`/`WorldBody`/`lib/types/api.ts:270` and the
aggregates; `SubstrateSpace` (`industry.ts:976-1025`) is re-cut as three independent
used/total pairs; the Industry panel's segmented land bar (`industry-rows.ts:265-273`)
becomes one bar per budget; Astrography's habitable-percent-of-available
(`system-astrography.tsx:21-22`) is replaced by absolute people land + the per-body list.

**3. Fill-best-first habitability quality.** People-land bodies are sorted by score
(re-sorted on any aggregate rebuild, not only at generation). Quality = the
people-land-weighted mean score over the prefix the current population occupies
(`population / POP_CENTRE_DENSITY` against cumulative people land). Edge states: population
0 (or an empty prefix) reads the top body's score, so a seed colony opens at its best
world's quality; the prefix clamps at the last body (overrun via housing-rot overshoot
floors quality at the all-bodies mean). Cached per system and recomputed only when the
occupied prefix crosses a body boundary — most systems have one people-land body and a
constant quality; the mechanic's live audience is mixed and ocean/jungle/boreal-led systems
(quality 0.6-0.7), growing as pop types and terraforming arrive.
**Coupling:** quality scales `growthRate` INSIDE `populationDelta` (a new parameter;
`lib/engine/population.ts:465-467`), growth term only, never the returned delta — the
population processor's growth/death isolations (`lib/tick/processors/population.ts:124-136`)
stay exact. Sign condition, stated: with `growthRate == declineRate == 0.0005`
(`lib/constants/population.ts:126-127`), net growth is positive only while
`quality × crowdFactor × (1−shortfall) > unrest` — so a marginal-land system under sustained
stress genuinely shrinks. That is intended (hard worlds are fragile, owner 2026-08-23), and
the exit exists: **abandonment fires on population < `ABANDON_POP_FLOOR` regardless of the
famine bit** (`lib/tick/processors/population.ts:118` drops the `survivalShortfall`
requirement) — decline-to-empty ends the colony through the shipped abandonment reset.
Colonist delivery and diffusion migration read popCap/unrest only and are deliberately
quality-blind (a low-quality world still fills to its built housing, and being empty, fills
first) — accepted as intended, watched by a calibration read.
**Surfaces:** the Population tab's growth line shows the multiplier explicitly
("Growth ×0.93 — habitability") with a fill-order decomposition tooltip (each body's score,
people land, occupancy, the settlement frontier marked); Astrography shows the same per-body
scores and occupancy. Quality is always shown as a story about bodies, never a bare number.

**4. Colonisability.** Eligible iff aggregate people land ≥ 1 housing level
(`effectiveSpaceCost(HOUSING_TYPE)`, replacing `EXPANSION.DEVELOP_HABITABLE_FLOOR` at
`colony-eligibility.ts:83` and `directed-build.ts:1387` — verified numerically identical).
Zero-people-land systems are never eligible; claims stay free (dead systems remain territory
and corridor). Colonisable share ≈ the threshold-clearing share, target 30-40% — and
deliberately asymmetric: blue-white and red-dwarf carry no above-threshold class for the
default pop, so 25% of stars (by class weight) wait for terraforming or adapted pop types.

**5. Mix targets and the ladder.** Sun-class weights shift toward dead classes; body counts
rise (yellow 4-8, orange 3-7, blue/red 2-5); boreal seats mainly on orange (and lightly
yellow/red), gaia very rare on yellow/orange. The habitable-count damping ladder multiplies
BEFORE the `w > 0` candidate filter (`body-gen.ts:73-74`); its terminal entry is a FIXED
hard 0 at count 3 (not a calibration output — that zero is what makes a 4th impossible);
steps 1-2 are calibration outputs constrained by the count targets. Invariants, unit-tested:
every sun class keeps ≥1 positive-weight dead class; yellow and orange keep ≥1
positive-weight above-threshold class. Capitals are the stated exception (prefab prepended
post-roll, `universe-gen.ts:621`); the census reports them separately.

**6. Sizing anchors** (defaults from measurement, definitions from meaning):
- People land: anchor cohort = temperate + gaia + ocean + jungle + boreal. Mean full-build-out
  ≈ 10,000 pops (500 land at density 20); gaia tops the spread with max body capacity
  ≈ 20,000 (≈1,000 land). Arid/tundra land is authored (for future unlocking) but excluded
  from the anchor and from colonisability.
- **Deposit counts are DERIVED from demand at the anchor population, not from measured
  usage**: per resource, count band ≈ `Σ_goods(GOOD_CONSUMPTION[g] / OUTPUT_PER_UNIT[g]) ×
  target pop` (arable sums food + textiles; gas includes its fuel/chemicals/polymers recipe
  draw), evaluated at 10,000 and at the 20,000 max — e.g. water ≈ 35 extractors at the
  anchor (`physical-economy.ts:62-63` ÷ `industry.ts:198-206`). The measured worked medians
  (claims 5-7) are a demand reading at HOME_SYSTEM_POP 5,000, quoted as a floor sanity check
  only. `OUTPUT_PER_UNIT`'s overrides — whose docstring premise "extractor count is
  deposit-capped" becomes TRUE for the first time — are authored jointly with the counts.
  Rich/poor bands spread around the derived typical so rich fields read rich and poor ones
  genuinely bind.
- Industry land: generous (labour and logistics bind, not land); a cramped archetype is a
  deliberate authoring choice.

**7. Consequential re-anchorings** (each verified at review; none may surprise a reader):
- **Expansion claim scoring** (`expansion.ts:46-52`): BOTH substrate terms normalise on the
  `placeHomeworlds` pattern (people land ÷ galaxy max; diversity ÷ `RESOURCE_TYPES.length`),
  then `SCORE_WEIGHTS` and `SCORE_FLOOR` re-tune together against the [0,1] scale.
  `homeworldResourceDiversity` (`faction-gen.ts:158-160`) saturates on the same body-count
  rise and re-tunes in the same pass; homeworld-placement distribution is a calibration read.
- **Colonisation value** (`colonisation-value.ts:80-92,150-168`): all THREE land
  coefficients re-anchor together — `LAND_PREMIUM` down ~6×, `LAND_DEPOSIT_WEIGHT` up by the
  deposit-count collapse ratio, `LAND_GENERAL_WEIGHT` against the authored industry-land
  scale — docstrings rewritten so "small secondary" stays true; `SEED_POP_COST_WEIGHT`
  (`constants/colonisation.ts:35`) re-checks. σ and `landGate` distributions are calibration
  reads alongside the U-vs-L share.
- **Development normaliser — DECISION CLOSED: accept and calibrate** (owner, 2026-08-23).
  `popRef`/`industryRef` stay galaxy MAXes (`development.ts:99-107`). Honest numbers: today's
  popRef ≈ 20,465 pop-potential (largest capital, census max — NOT the 14,150 mean);
  modelled post-change max ≈ 35-40K (gaia + 2 habitable siblings; capitals stack the
  prefab) — the reference roughly DOUBLES and every development score deflates. Consumers
  read `(1 − dev)` (`directed-build.ts:610`; `processors/directed-build.ts:532-533` →
  `construction.ts:156-158`), so the low-dev majority moves ~1 point and the shift
  concentrates on developed cores. `industryPotential` keeps an explicit deposit→land
  coefficient (re-authored `DEPOSIT_SLOT_FOOTPRINT`) so counts and land stay commensurable;
  its second consumer `developmentPotential` (`development-points.ts:126-136`, the vitals
  readout) and the prefab (`homeworld-prefab.ts:164`) move with it. Calibration reads:
  median/p10 `systemDevelopment`, speculative-build volume, construction-reserve fade —
  cohorted, both horizons, vs baseline. Pre-booked fix if reads breach the health bar:
  high-percentile refs instead of max.
- **Economy-type / events guard** (unchanged from v2): histogram over natural systems
  before/after (the classifier is share-based and scale-invariant to a common count factor —
  verified), per-capital labels stable, no class starved OR flooded (`total ≤ 0 → extraction`
  catches more zero-deposit systems).
- **Homeworld prefab**: `homeworldGardenBody` (`homeworld-prefab.ts:141-167`) authors its
  budgets DIRECTLY — temperate-class score 1.0, people land / industry land / per-resource
  counts explicit, nesting back-solves deleted. `HOME_SYSTEM_POP` stays 5,000: capitals are
  deliberately mid-sized against the 10,000 average (owner, 2026-08-23); calibration target
  "homeworld quality ≈ 1.0" derives from the authored score.
- **Instruments**: `scripts/substrate-coherence.ts` (`npm run report:coherence`) is re-cut as
  the TRACKED home of the gen-time calibration targets (replacing the scratch census; ≥5
  seeds, per-seed spread, capitals separated) — its partition identity is replaced by the
  three budgets' own invariants (dead classes exactly 0 people land; counts integer and
  in-range; aggregates = Σ contributing bodies). Harness: `survival-short`
  (`cohort-analysis.ts:246`) re-cut to zero-food-capacity among COLONISABLE systems; the
  zero-local-food colonisable cohort gets food-satisfaction + famine/abandonment reads.
- **Body danger**: `bodyDanger` (Σ over bodies, volcanic-only 0.05) inflates with body
  counts — `dangerBaseline` re-authored to hold the per-system distribution, or the badge
  bands (`lib/utils/system.ts:5-9`) re-cut; census reports the before/after distribution.
- **Alert bar**: `no_housing_headroom` follows the new single-bound headroom automatically;
  meaning narrows to genuinely people-land-full worlds; browser-smoke it.
- **Test invariant**: `archetype-weights.test.ts:27-34` re-states as "gaia_world holds the
  top people-land band".

**8. Save format.** `SAVE_FORMAT_VERSION` 15 → 16 (`save.ts:29`), MANDATORY — the rename +
field changes invalidate old saves and the bump makes them fail cleanly (`save.ts:78-83`).
World stays JSON-serialisable.

**9. Surfaces.** Astrography: per-body class, score, lock state, deposits + work modifier
(as contribution weight), occupancy. Population tab: the quality/growth line and fill-order
tooltip (§3). Industry: one land bar per budget; space tables on the renamed budgets. The
migration engine is untouched (reads BUILT popCap — `migration.ts:52,63`; the v1 "gradients
steepen" claim stays withdrawn).

### Calibration targets

Gen-time (targets 1-3, 5-6) read by the re-cut `npm run report:coherence` over ≥5 seeds,
capitals separated; run-time (4, 7-9) by `npm run simulate` both horizons plus the 30K read.

1. Habitable-count distribution (bodies with score ≥ threshold, natural-gen): ≥1 in 30-40%,
   ≥2 in 5-10%, =3 ≤1.5%, ≥4 zero across all seeds. Per sun class: yellow and orange within
   ~15-60% ≥1; blue-white and red-dwarf at 0 BY DESIGN (reported to confirm, not to fix).
2. People-land anchor: mean full-build-out over the anchor cohort ≈ 10,000 pops; max body
   ≈ 20,000; SYSTEM-level max reported (bounds popRef); arid/tundra land reported separately.
3. Colonisable share 30-40% = threshold-clearing share; below-floor violations zero.
4. Deposit sufficiency and realism: per-resource galaxy production and market cover for the
   seven tier-0 resources vs the claim-3 baseline, gas separately; food and water
   satisfaction + famine-band + abandonment-by-cause counts on the anchor cohort;
   worked/authored ratio ≥0.5 median on homeworld top-2 resources (colony cohort reported,
   no target — worked count is demand/staffing-bound).
5. Quality: distribution at both horizons cohorted single- vs multi-people-land-body systems
   (the fold's live audience); homeworlds ≈ 1.0; population trajectory cohorted by quality
   band (the fragile-worlds read), with net colonist-delivery inflow vs net population
   change by quality band (the pump watch).
6. Economy-type histogram guard (above).
7. Sim health bar green both horizons; conservation identities pass; colonisation pacing
   (foundings, concurrency) vs claim-3 baseline, expected direction DOWN — licensed by the
   review's check that founding appetite already consumes the whole colonisable galaxy.
8. Development reads: median/p10 `systemDevelopment`, speculative-build volume,
   construction-reserve fade — vs baseline, both horizons.
9. Per-faction floor: reachable-colonisable candidates at founding era (min/p10 across
   factions) and factions with zero developments by 10K.


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
