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

## Build plan

Four stages on `feat/habitability-seeding`, each ending in a sim gate — stages are check-in
pauses, one branch, one squash PR. Every `Files` list is a floor, not a ceiling. All citations
below re-verified against the working tree this session (2026-08-23).

**Execution rule (AGENTS.md → Tooling): long runs — full suite, `npm run simulate`, multi-seed
measurements — are run by the MAIN session, foreground. Dispatched agents run only their
scoped test files, synchronously; agent-designed measurements split into script (agent) →
run (session) → analysis (agent).**

### Resolution table

Every quantity a task's Interface names, resolved before the tasks were written.

| Measure (spec prose) | State | Producer / receipt |
|---|---|---|
| habitability score per class × pop type | new | T1 (`BODY_ARCHETYPES` column) |
| `HABITABILITY_THRESHOLD` (0.5) | new | T1 |
| people-land range per class | new | T1 |
| industry-land range per class | new | T1 |
| per-resource deposit-count ranges | new | T1 — derived from `GOOD_CONSUMPTION` (`lib/constants/physical-economy.ts:60-69`) ÷ `OUTPUT_PER_UNIT` (`lib/constants/industry.ts:181+`), formula spec-authored, carried verbatim |
| extraction work modifier per class | new | T1 |
| tech-lock flag per class | new | T1 (class-level constant; no per-body world field — locks only release, unlock is future tech) |
| habitable-count damping ladder (hard 0 at 3) | new | T1 |
| sun-class weights / body counts | exists | `lib/constants/bodies.ts:93-120` (retuned T1) |
| per-body peopleLand / industryLand / counts | new | T2 (`GeneratedBody` re-cut) |
| system people-land aggregate ("clears the threshold") | new | T2 (`substrateAggregates`) |
| system industry-land aggregate | new | T2 |
| `extractionEfficiency[r]` (count-weighted mean modifier) | new | T2 |
| `yieldMult` (pure ground grade — kept) | exists | `depositGradeVector`, `lib/engine/body-gen.ts:158` |
| `rollQualityBand` (kept) | exists | `lib/engine/substrate-space.ts:52-58` |
| extraction output = count × yieldMult × efficiency | new seam | T2, at `lib/engine/industry.ts:480-481` (the one tier-0 yield application) |
| `SAVE_FORMAT_VERSION` 15→16 | exists | `lib/world/save.ts:29` (bumped T2) |
| `generalSpaceUsed` → `industryLandUsed` | exists | `lib/engine/industry.ts:329-337`; six readers verified: `build-options.ts:77`, `construction-centre.ts:86`, `directed-build.ts:247,564,1005`, `development.ts:132` (T3) |
| `habitableHousingHeadroom` single-bound | exists | `lib/engine/directed-build.ts:243-250` (T3) |
| `SubstrateSpace` / `summariseSpace` three pairs | exists | `lib/engine/industry.ts:976-1025` (T3) |
| colonisability floor = `effectiveSpaceCost(HOUSING_TYPE)` | exists | `DEFAULT_SPACE_COST` 1.0 (`lib/constants/industry.ts:177,256-260`) = `DEVELOP_HABITABLE_FLOOR` 1 (`lib/constants/expansion.ts:27`) — numerically identical, verified (T4) |
| floor call sites | exists | `lib/services/colony-eligibility.ts:83`, `lib/world/tick.ts:1574` → `directed-build.ts:1236-1237,1387` (T4) |
| "fill-best-first" quality (sorted prefix mean) | new | T7 (`lib/engine/habitability.ts`) |
| `POP_CENTRE_DENSITY` (prefix denominator) | exists | `lib/constants/industry.ts:179` |
| growth coupling ("multiplies growth") | exists fn | `populationDelta`, `lib/engine/population.ts:458-474` — new param T8 |
| growth/death isolations that must stay exact | exists | `lib/tick/processors/population.ts:124-136` (T8) |
| abandonment famine-bit drop | exists | `lib/tick/processors/population.ts:118`; `ABANDON_POP_FLOOR` 1 < `COLONY_SEED_POP` 2, so no newborn insta-abandon (verified `lib/constants/population.ts:141`, `lib/constants/expansion.ts:32`) (T8) |
| claim scoring ("normalise on the placeHomeworlds pattern") | exists | `lib/engine/expansion.ts:46-52`; pattern at `lib/engine/faction-gen.ts:184,195` (T10) |
| `homeworldResourceDiversity` | exists | `lib/engine/faction-gen.ts:158-162` (T10) |
| `colonyValue` land coefficients + σ | exists | `lib/engine/colonisation-value.ts:80-92,150-168`; `SEED_POP_COST_WEIGHT` `lib/constants/colonisation.ts:35` (T11) |
| `popRef`/`industryRef` galaxy maxes | exists | `lib/engine/development.ts:99-107` (T12) |
| `industryPotential` deposit→land coefficient | exists | `lib/engine/development.ts:89-91` via `DEPOSIT_SLOT_FOOTPRINT` (`substrate-gen.ts:22`, re-authored T12) |
| `developmentPotential` (vitals) | exists | `lib/engine/development-points.ts:126-136` (T12) |
| `(1−dev)` consumers (calibration reads only) | exists | `directed-build.ts:610`; `processors/directed-build.ts:532-533` → `construction.ts:156` |
| economy-type classifier (share-based, scale-invariant) | exists | `lib/engine/economy-type.ts` (guard read T6) |
| `bodyDanger` / `dangerBand` | exists | aggregate `body-gen.ts:159`; bands `lib/utils/system.ts:4-10` (census read T6; re-cut booked at Gate A) |
| events cap (accepted dilution) | exists | `lib/constants/events.ts:89-96` — no change; events-revisit row verified in `docs/ROADMAP.md:77` |
| `survival-short` cohort re-cut | exists | `lib/tick-harness/cohort-analysis.ts:241-248` (T9) |
| coherence instrument + alias | exists | `scripts/substrate-coherence.ts`, `package.json:14` `report:coherence` (re-cut T6) |
| `no_housing_headroom` alert | exists | `lib/constants/alerts.ts:128`, `lib/services/alerts.ts:653` — follows T3 automatically; smoke Gate D |
| migration untouched (reads built popCap) | exists | `lib/engine/migration.ts:52,63` |
| delivery quality-blind (watched, not changed) | exists | `lib/engine/colonist-delivery.ts` header (T9 watch metric) |
| `homeworldGardenBody` direct authoring | exists | `lib/engine/homeworld-prefab.ts:141-168`; prefab prepend `universe-gen.ts:621`; `economyType` writes `universe-gen.ts:351,633` (T2) |
| `habitable: boolean` deletion set | exists | `bodies.ts:15`, `body-gen.ts:19,98`, `world/types.ts:262`, `world/gen.ts:153`, `api.ts:253`, `services/universe.ts:104`, `body-card.tsx:16,21` (T5/T13) |
| `availableSpace` deletion set | exists | 7 modules per `npm run impact -- availableSpace`: substrate-space, body-gen, universe-gen, world/gen, world/types, system-astrography, services/universe (+ coherence script) (T5) |
| new per-resource column family floor | walked | sibling `yield*`: `engine/resources.ts:59-83,155`, `world/types.ts:247`, `world/gen.ts:144`, `world/tick.ts:234`, `tick/processors/good-market-state.ts:78-101`, services construction/system-industry-readout/trade-flow/dev-tools (T2) |

No measure resolved unresolvable. Rename reader sets sized with `npm run impact`:
`habitableSpace` 22 modules, `generalSpace` 18, `availableSpace` 7 — pasted receipts in session;
the spec's §2 reader list matches.

### Stage 1 — three-budget substrate

### Task 1 — Author the archetype tables, scores, budgets, counts and ladder
Files:      `lib/constants/bodies.ts`, `lib/constants/substrate-gen.ts`,
            `lib/constants/industry.ts` (OUTPUT_PER_UNIT overrides authored jointly with counts),
            `lib/types/game.ts` (BodyArchetypeId union: +tundra_world, boreal_world, gaia_world;
            garden_world→temperate_world), `lib/constants/__tests__/archetype-weights.test.ts`,
            every `garden_world` literal (grep set incl. `lib/engine/homeworld-prefab.ts:167`).
Interface:  `BodyArchetype` gains: `scores: { default: number }` (per-pop-type columns, one row
            ships), `peopleLand: {min,max}`, `industryLand: {min,max}`,
            `depositCounts: Partial<Record<ResourceType, {min,max}>>` (integers),
            `extractionModifier: number` in (0,1], `techLocked: boolean`, kept `dangerBaseline`.
            New constants: `HABITABILITY_THRESHOLD = 0.5`; `HABITABLE_COUNT_DAMPING` ladder whose
            entry at count 3 is a FIXED hard 0 (steps 1-2 calibration-owned). Sun-class weights and
            body counts retuned per spec §5 (yellow 4-8, orange 3-7, blue/red 2-5; boreal on
            orange; gaia very rare). Score table per spec §1, verbatim. Transitional: the legacy
            `habitable`/`generalWeight`/`habitableFraction`/`resourceBase` columns stay on every
            row (new rows author placeholder legacy values) so the old partition compiles until T2
            deletes both.
Proves:     (1) every sun class keeps ≥1 positive-weight dead class; (2) yellow and orange keep
            ≥1 positive-weight above-threshold class; (3) the ladder's terminal entry is exactly 0
            (a 4th habitable is impossible by table, not by tuning); (4) gaia_world holds the top
            people-land band (restates `archetype-weights.test.ts:27-34`); (5) every authored count
            range is integer with min ≤ max, and the water band contains the spec's anchor
            derivation (≈35 at 10,000 pops) — fails on an empty or unauthored table (vacuity).
Consumes:   —

### Task 2 — Generation rewrite: bodies author budgets; aggregates; save bump
Files:      `lib/engine/body-gen.ts`, `lib/engine/substrate-space.ts` (partitionBody deleted;
            rollQualityBand/depositDisplayName kept), `lib/engine/homeworld-prefab.ts`,
            `lib/engine/universe-gen.ts`, `lib/engine/resources.ts` (extractionEfficiency column
            helpers beside slot/yield families), `lib/world/types.ts`, `lib/world/gen.ts`,
            `lib/world/tick.ts`, `lib/tick/rows.ts`, `lib/tick/processors/good-market-state.ts`,
            `lib/engine/industry.ts` (:460-481 seam), `lib/world/save.ts`, services threading
            `yields` (`construction.ts`, `system-industry-readout.ts`, `trade-flow.ts`,
            `dev-tools.ts`).
Interface:  `GeneratedBody { bodyType, size (display flavour), peopleLand, industryLand,
            counts: ResourceVector, quality: ResourceVector }` — `habitable` and the partition
            fields die here, along with T1's transitional legacy columns, `SIZE_MIN/MAX` and
            `SPACE_PER_SIZE`. `rollBody` draws each budget uniform-in-range from the table;
            counts integer. The damping ladder multiplies above-threshold class weights BEFORE the
            `w > 0` candidate filter (site `body-gen.ts:73-74`), keyed on above-threshold bodies
            already rolled. `substrateAggregates(bodies)` returns `{ habitableSpace (=Σ peopleLand
            over score ≥ threshold ∧ unlocked), generalSpace (=Σ industryLand over unlocked),
            slotCap (=Σ counts over unlocked), yieldMult (kept), extractionEfficiency:
            ResourceVector (count-weighted mean extractionModifier; 1.0 where no counts),
            bodyDanger, availableSpace (transitional identity: peopleLand + industryLand +
            Σcounts × DEPOSIT_SLOT_FOOTPRINT — dies in T5) }` — NEW SEMANTICS UNDER THE OLD SYSTEM
            FIELD NAMES; the mechanical rename is T5. Tier-0 production multiplies
            `extractionEfficiency[resource]` at `industry.ts:480-481`, threaded on the same row
            path as `yields`. `homeworldGardenBody()` authors temperate class, score 1.0, explicit
            budgets and counts; the back-solve from buildings is deleted. `SAVE_FORMAT_VERSION = 16`
            (one shipped bump; mid-branch shape changes ride the same 16 — dev saves are
            disposable, the guarded boundary is 15→16 failing cleanly per `save.ts:78-83`).
Proves:     (1) a tech-locked class contributes zero counts, zero extractionEfficiency weight AND
            zero industry land to aggregates; (2) arid/tundra contribute 0 to system people land
            while their authored peopleLand stays visible per-body (dark land) and their deposits
            count; (3) with a forced all-habitable table a system never carries a 4th
            above-threshold body, and dead classes remain rollable at every ladder step; (4) a
            resource with zero counts reads extractionEfficiency 1.0 (no NaN — matches the
            yieldMult convention); (5) an extractionModifier of 0.5 halves tier-0 output and
            leaves tier-1+ untouched; (6) a v15 save refuses with the clean version error and a
            fresh world round-trips through serialise/deserialise with the new columns finite.
Consumes:   T1.

### Task 3 — The build rule: housing bills people land, industry bills industry land
Files:      `lib/engine/industry.ts` (:329-337, :976-1025), `lib/engine/directed-build.ts`
            (:243-250, :564, :1005), `lib/engine/build-options.ts` (:77,:95),
            `lib/engine/construction-centre.ts` (:86), `lib/engine/development.ts` (:132),
            `lib/services/alerts.ts` (follows automatically — test only).
Interface:  `industryLandUsed(buildings): number` (renamed `generalSpaceUsed`; housing excluded,
            extractors excluded). `habitableHousingHeadroom` drops `min(…, remainingGeneral)` and
            returns the people-land bound alone. `SubstrateSpace` re-cut as three independent
            used/total pairs (people / industry / deposits); `summariseSpace(peopleLand,
            industryLand, counts, buildings)` fills them. All six former `generalSpaceUsed` readers
            consume the renamed measure; `development.ts:131-132`'s manual `− housingSpace` net-out
            is deleted as redundant.
Proves:     (1) a system with industry land exactly full still builds housing given free people
            land; (2) people land full blocks housing despite vast free industry land; (3)
            factories/academies/complexes/centres never bill people land; (4) extractors bill
            neither budget (N extractors leave both used-readings unchanged); (5) the development
            factory term is unchanged by the net-out deletion on a mixed build (the two
            subtractions were equivalent — contradiction check against the old formula); (6)
            `no_housing_headroom` fires only for genuinely people-land-full systems (a system the
            OLD shared-general bound would have flagged no longer alerts).
Consumes:   T2.

### Task 4 — Colonisability: the floor is one housing level of people land
Files:      `lib/services/colony-eligibility.ts` (:83-89), `lib/world/tick.ts` (:1574),
            `lib/engine/directed-build.ts` (:1236-1237 docstring), `lib/constants/expansion.ts`
            (:27 deleted).
Interface:  Both gates read `effectiveSpaceCost(HOUSING_TYPE)` (verified numerically identical to
            the retired `EXPANSION.DEVELOP_HABITABLE_FLOOR`); `habitableFloor` param keeps its
            wire shape, sourced from the housing cost. Claims (control tier) untouched — dead
            systems stay claimable territory and corridor.
Proves:     (1) a zero-people-land system is never eligible and never proposed, at BOTH call
            sites; (2) exactly one housing level of people land is eligible, just under is not;
            (3) a dead system is still claimable; (4) the eligibility service's two floor checks
            (`:83` and the null-sizing fallback `:87-89`) agree — no eligible-but-unsizeable gap.
Consumes:   T2.

### Task 5 — Mechanical renames and deletions, whole-tree
Files:      (floor — tsc- and grep-driven from the impact receipts) `lib/world/types.ts:225-284`,
            `lib/engine/{body-gen, substrate-space, directed-build, build-options,
            colonisation-value, development, development-points, expansion, faction-gen,
            homeworld-prefab, universe-gen, construction-centre, industry, resources}.ts`,
            `lib/tick/rows.ts`, `lib/tick/world/directed-build-world.ts`, `lib/world/{gen,tick}.ts`,
            `lib/services/{alerts, build-options, colony-eligibility, construction-orders,
            system-development, universe}.ts`, `lib/types/api.ts:249-276`, `lib/types/guards.ts`,
            compile-level UI (`system-astrography.tsx`, `body-card.tsx`, `industry-rows.ts`,
            `industry-panel.tsx`, panel test fixtures), `scripts/substrate-coherence.ts`
            (compile only — re-cut is T6), plus every test naming an old field.
Interface:  `habitableSpace` → `peopleLand`; `generalSpace` → `industryLand`; `slotCap` →
            `depositCounts` with columns `slot*` → `count*`; `availableSpace` DELETED from
            `WorldSystem`/`WorldBody`/`api.ts:270`/aggregates (Astrography's percent read replaced
            by absolute people land — compile-minimal here, redesign T13); per-body/`BodyView`
            `habitable: boolean` DELETED, `BodyView` gains `score` + `locked` (band presentation
            T13). Semantics identical to T2-T4 — this task moves names only.
Proves:     (1) a repo text grep for the retired vocabulary (`habitableSpace`, `generalSpace`,
            `slotGas`…, `availableSpace`, `garden_world`, `habitable:` on body shapes) returns
            zero hits outside git history — the strand sweep IS the task's test; (2) a fresh world
            round-trips save/load at version 16 with renamed columns; (3) the tick adapter's
            column narrowing fails red when a `count*` column is absent (guards moved, not
            widened); (4) `npm run build` and the full suite green with zero `as` casts introduced.
Consumes:   T2, T3, T4.

### Task 6 — Re-cut the coherence instrument as the tracked census
Files:      `scripts/substrate-coherence.ts` (alias `report:coherence` unchanged,
            `package.json:14`).
Interface:  Reports over ≥5 seeds with per-seed spread, capitals separated: habitable-count
            distribution overall and per sun class (target 1); people-land anchor stats over the
            anchor cohort, max body, SYSTEM-level max (bounds popRef), arid/tundra dark land
            separately (target 2); colonisable share = threshold-clearing share (target 3);
            economy-type histogram before/after guard (target 6); bodyDanger per-system
            distribution; invariants — dead classes exactly 0 people land, counts integer and
            in-range, aggregates = Σ contributing unlocked bodies, zero below-floor eligibility
            violations. Non-zero exit on any invariant breach. Replaces the retired partition
            identity. The gitignored `temp/habitability-census.ts` becomes disposable.
Proves:     (1) an invariant breach exits non-zero (seen red by breaking a table row); (2)
            capitals never pollute natural-gen cohorts; (3) single-seed output is impossible
            (per-seed spread always printed); (4) no assertion survives from the old partition
            identity (a vacuous green against the new model fails).
Consumes:   T2, T5.

### Gate A — the substrate stands
Arms:       T1-T6.
Reads:      `npm run build`; `npx vitest run`; `npm run report:coherence` (targets 1-3, 6,
            invariants, bodyDanger); `npm run simulate` BOTH horizons — health bar, conservation
            identities, pacing direction (foundings + concurrency vs the claim-3 baseline,
            expected DOWN).
Merge condition: conservation identities pass (a failure means the founding ledger is out, not
            mistuning); targets 1-3 inside bands — the constant-retune loop happens HERE against
            T1's table, before any downstream task consumes the numbers; economy-type guard: no
            class starved or flooded, per-capital labels stable. **Booked at this gate:** if the
            bodyDanger distribution breaches the current badge bands, re-author `dangerBaseline`
            values or re-cut `dangerBand` (`lib/utils/system.ts:5-9`) inside this stage.

### Stage 2 — quality × growth

### Task 7 — The fill-best-first quality fold
Files:      `lib/engine/habitability.ts` (new), `lib/world/types.ts` (cached per-system quality),
            `lib/tick/processors/population.ts`, `lib/tick/rows.ts` + the population processor's
            world interface/adapters (static per-body `{score, peopleLand}` summary in),
            `lib/world/tick.ts`, `lib/world/save.ts` (field rides version 16).
Interface:  Pure `systemHabitabilityQuality(bodies: {score, peopleLand}[], population):
            { quality, frontierIndex }` — bodies sorted by score desc (re-sorted on any aggregate
            rebuild, not only at generation); quality = people-land-weighted mean score over the
            occupied prefix (`population / POP_CENTRE_DENSITY` against cumulative people land);
            population 0 / empty prefix reads the TOP body's score; prefix clamps at the last
            body (overrun floors at the all-bodies mean). Cached on the system row; recomputed in
            the per-cycle fold only when the occupied prefix crosses a body boundary.
Proves:     (1) an empty system reads its best body's score, not a mean and not 0; (2) overrun
            past all land reads the all-bodies mean (clamp arm); (3) a mid-body prefix weights the
            partial last body by its occupied land only (boundary arithmetic); (4) population
            movement WITHIN a body never recomputes and a boundary crossing always does — the
            single-body common case computes once; (5) an unsorted input body list still folds
            best-first (the sort is inside the seam, not assumed — vacuity check).
Consumes:   T2, T5.

### Task 8 — Growth coupling and the hard-world exit
Files:      `lib/engine/population.ts` (:458-474), `lib/tick/processors/population.ts`
            (:113, :118, :124-136), `lib/constants/population.ts` (docstrings),
            `lib/services/alerts.ts` (:87,:308 countdown docstring follows the changed rule).
Interface:  `populationDelta(population, popCap, d, unrest, params, quality)` — quality multiplies
            the GROWTH term only, never the returned delta shape; processor passes the cached
            quality. Abandonment Rule 2 drops the `supply.survivalShortfall` conjunct: fires on
            post-delta population < `ABANDON_POP_FLOOR` alone (owner decision c).
Proves:     (1) decline and overshoot-death are bit-identical across quality values, and the
            processor's growth/death isolation folds still attribute exactly under quality ≠ 1;
            (2) the sign condition: with growthRate = declineRate, net is negative when
            quality × crowdFactor × (1−d) < unrest — a marginal-land system under sustained
            stress genuinely shrinks; (3) a colony declining to empty WITHOUT famine now abandons
            (red-proof: restore the conjunct, watch it fail); (4) a fresh seed colony
            (`COLONY_SEED_POP` 2 > floor 1) survives an unlucky first cycle — the boundary sits
            below the seed, not above it.
Consumes:   T7.

### Task 9 — Harness reads for the new cohorts
Files:      `lib/tick-harness/cohort-analysis.ts` (:238-248) and the report assembly it feeds.
Interface:  `survival-short` re-cut to zero-food-capacity among COLONISABLE systems; new
            quality-band cohort (single- vs multi-people-land-body split); abandonment-by-cause
            counts (famine-collapse vs decline-to-empty, distinguishable after T8); the pump
            watch — net colonist-delivery inflow vs net population change by quality band.
Proves:     (1) an uncolonisable dead rock no longer lands in `survival-short`; (2) quality-band
            assignment holds at band boundaries; (3) the pump signature is detectable: a cohort
            with positive delivery inflow and negative net population reads as such, not as noise
            (vacuity: a metric that cannot disagree with growth is not the watch); (4)
            abandonment-by-cause sums to total abandonments.
Consumes:   T7, T8.

### Gate B — quality lives in the galaxy
Arms:       T7-T9.
Reads:      `npm run simulate` BOTH horizons: quality distribution cohorted single- vs
            multi-people-land-body (target 5); homeworld quality ≈ 1.0; population trajectory by
            quality band (the fragile-worlds read); abandonment-by-cause; the pump watch; pacing
            vs baseline unchanged in direction from Gate A.
Merge condition: health bar green both horizons; conservation identities pass; homeworld quality
            reads ≈ 1.0 (the prefab's authored score arriving intact end-to-end); no
            quality-driven mass-death anomaly in the fragile cohort (shrinking is intended,
            NaN/runaway is not).

### Stage 3 — consequential re-anchorings

### Task 10 — Expansion claim scoring and homeworld placement
Files:      `lib/engine/expansion.ts` (:46-52), `lib/constants/expansion.ts` (SCORE_WEIGHTS,
            SCORE_FLOOR), `lib/engine/faction-gen.ts` (:158-162, :184-195), `lib/world/tick.ts`
            (claim-candidate assembly, diversity count at :666, galaxy people-land max threaded).
Interface:  `scoreClaimCandidate` consumes normalised terms — people land ÷ galaxy max, diversity
            ÷ `RESOURCE_TYPES.length`, both in [0,1] (the `placeHomeworlds` pattern) — with
            `SCORE_WEIGHTS`/`SCORE_FLOOR` re-tuned on that scale. `homeworldResourceDiversity`
            re-tuned in the same pass against the higher body counts.
Proves:     (1) both substrate terms are bounded [0,1] for any candidate — a giant system cannot
            dominate by raw scale (normalisation applied, not merely weights shrunk); (2)
            SCORE_FLOOR still excludes exactly the zero-substrate candidates on the new scale;
            (3) among equal-distance candidates, more people land still outranks (no term
            silently dropped); (4) the diversity term still discriminates at the new body counts
            (not saturated identical across candidates).
Consumes:   T5.

### Task 11 — Colonisation value coefficients
Files:      `lib/engine/colonisation-value.ts` (:150-168 docstrings), `lib/constants/colonisation.ts`
            (LAND_PREMIUM ↓~6×, LAND_DEPOSIT_WEIGHT ↑ by the count-collapse ratio,
            LAND_GENERAL_WEIGHT against the authored industry-land scale; `SEED_POP_COST_WEIGHT`
            re-checked).
Interface:  Same `colonyValue` shape; three land coefficients re-authored on the new scales;
            docstrings rewritten so "small secondary" stays true of the L term.
Proves:     (1) on a representative candidate set the U term still leads and L is secondary — the
            docstring's claim is asserted, not just written; (2) the σ gate arithmetic is
            untouched (contradiction check); (3) a below-floor candidate never reaches valuation
            (the T4 gate sits upstream at `directed-build.ts:1387`).
Consumes:   T4, T5.

### Task 12 — Development normaliser: accept and calibrate
Files:      `lib/engine/development.ts` (:89-91, :99-107, :123-142), `lib/engine/development-points.ts`
            (:126-136), `lib/constants/substrate-gen.ts` (`DEPOSIT_SLOT_FOOTPRINT` re-authored
            against the count scale), `lib/engine/homeworld-prefab.ts` (consistency of the
            authored budgets with the potentials).
Interface:  `popRef`/`industryRef` stay galaxy maxes (owner: accept and calibrate);
            `industryPotential(depositCounts, industryLand)` keeps the one explicit deposit→land
            coefficient so counts (~5-35) and land (~40-300) stay commensurable;
            `habitablePotentialPop(peopleLand)` unchanged in shape; `developmentPotential` moves
            with the same coefficient.
Proves:     (1) `systemDevelopment` stays finite in [0,1) for a zero-people-land system — the
            industry-only arm (`development.ts:138`) still fires under the new budgets; (2) an
            extractor-heavy and a factory-heavy system of equal converted footprint read
            comparable `industryPotential` (the coefficient is applied, not vestigial); (3) vitals
            `developmentPotential` and `systemDevelopment` share the one coefficient (no second,
            disagreeing constant); (4) empty-galaxy refs still read zero without NaN.
Consumes:   T3, T5.

### Gate C — the anchors hold
Arms:       T10-T12.
Reads:      `npm run simulate` BOTH horizons: median/p10 `systemDevelopment`, speculative-build
            volume, construction-reserve fade (target 8), cohorted vs baseline; σ and landGate
            distributions plus the U-vs-L share (spec §7); homeworld-placement distribution;
            per-faction floor — reachable-colonisable candidates at founding era (min/p10) and
            factions with zero developments by 10K (target 9).
Merge condition: health bar green; no faction starved of candidates below the target-9 floor;
            development reads inside the coarse health bar. **Booked at this gate:** if the
            development reads breach the health bar, switch `developmentRefs` to high-percentile
            refs instead of max (the spec's pre-booked fix) inside this stage.

### Stage 4 — surfaces

### Task 13 — Astrography: bodies tell the three-budget story
Files:      `components/panels/system-astrography.tsx`, `components/system/body-card.tsx`,
            `lib/services/universe.ts` (:98-116), `lib/types/api.ts` (BodyView,
            SystemSubstrateData), `lib/hooks/use-system-substrate.ts`,
            `lib/utils/substrate.ts` (deposit features on counts).
Interface:  `BodyView` carries class, `score`, `locked`, `peopleLand`, `industryLand`, `counts`,
            `extractionModifier`, `occupied` (from the T7 fold via the service);
            `SystemSubstrateData` header shows absolute people land (the percent-of-available
            read at `system-astrography.tsx:21-22` died with `availableSpace`). The extraction
            modifier is presented as a contribution weight to the system's effective yield, per
            spec §1 — stated in the UI copy.
Reuse:      `Card` (variant/padding), `Badge` (color/variant), `SectionHeader`, `EmptyState`,
            `StatRow`/`StatList` (label/children), `Tooltip` (`TooltipTriggerLabel` +
            `TooltipContent`), `QUALITY_BAND_DOT`/`QUALITY_BAND_TEXT` — all props read this
            session. `BodyCard` is re-cut in place (existing component; name still matches
            behaviour).
Proves:     (1) a locked body states its lock in accessible text and shows a score band, never
            the retired Habitable badge; (2) the contribution-weight wording renders (text
            assertion, not class); (3) a zero-people-land system shows absolute 0, never NaN or a
            percent; (4) the occupancy/frontier marking appears on the right body (role/text).
Consumes:   T5, T7.

### Task 14 — Population tab: the growth line and fill-order tooltip
Files:      `components/system/population-panel.tsx`, `lib/services/system-population.ts`,
            `lib/hooks/use-system-population.ts`, `lib/types/api.ts`,
            `components/system/habitability-tooltip-content.tsx` (new).
Interface:  The population read gains `{ growthMultiplier, fillOrder: [{className, score,
            peopleLand, occupied, frontier}] }` composed in the service from the cached fold —
            the component computes nothing. Renders "Growth ×0.93 — habitability" with the
            decomposition tooltip; quality is always shown as a story about bodies, never a bare
            number (spec §3).
Reuse:      `StatRow`, `Tooltip` (`TooltipTriggerLabel`/`TooltipContent`), `Card`,
            `SectionHeader` — props read this session.
            New: `habitability-tooltip-content` — searched the words a user of the behaviour
            would use ("fill order", "growth breakdown", "per-body occupancy"): nothing fits;
            `need-tooltip-content.tsx` is the analogous pattern but is needs-specific. Named for
            the behaviour.
Proves:     (1) the rendered multiplier is the service value, format-only (a NaN from the service
            is visible in DOM text — assert on text, not props); (2) the tooltip lists every
            people-land body in score order with the frontier marked (accessible text); (3) a
            single-body quality-1.0 world still renders the line at ×1.00 (the common case is not
            hidden); (4) an uninhabited system renders no growth line (`populationPanelView`
            interplay).
Consumes:   T7, T13 (BodyView vocabulary).

### Task 15 — Industry tab: one bar per budget
Files:      `components/system/industry-rows.ts` (:244-272), `components/system/industry-panel.tsx`
            (:670-680, :938-950, :1035-1045), `lib/services/system-industry-readout.ts`,
            `lib/types/api.ts` (SubstrateSpace re-export).
Interface:  The general-land partition type (`housing/factory/habitableFree/factoryFree`) is
            deleted; each budget renders its own used/free bar from T3's three pairs; space
            tables read the renamed budgets; deposits bar reads worked/authored counts.
Reuse:      the panel's existing bar idiom (`COPPER_HATCH` legend rows), `CompositionBar`
            (segments) where a split within one budget is needed — props read this session. No
            new component.
Proves:     (1) housing appears only in the people-land bar and factories only in the industry
            bar (cross-contamination fails the test); (2) the bar partition maths lives in a
            node-tested helper (jsdom style rule — the component test asserts text/roles, the
            helper asserts sums); (3) the deposit bar reads counts, never land units; (4) the
            retired habitableFree/factoryFree vocabulary is gone from DOM text and code.
Consumes:   T3, T5.

### Gate D — ship gate
Arms:       T13-T15 (and the whole branch).
Reads:      `npm run build`; full suite; `npm run report:coherence` final; `npm run simulate`
            both horizons — the PR quote (targets 4, 5, 7, 8, 9 final read); ONE 30K run for the
            target-5 trajectory (~8 min — state before launching; it overwrites the rolling
            autosave slot, so confirm Kai has no live save in flight); `npm run duplication` on
            the branch diff; browser smoke in one pass — Astrography, Population growth line,
            Industry bars, `no_housing_headroom` alert (memory: budget one browser smoke per
            browser-facing gate; Node can't see these).
Merge condition: conservation identities pass; calibration targets 1-9 each read and inside
            bands or explicitly accepted by Kai; the doc fold (below) done on the branch; smoke
            go-ahead given by hand.

### Verification

The finished feature is proven in the galaxy, not in fixtures: `npm run report:coherence`
(gen-time targets 1-3, 5-6 gen-side, capitals separated, ≥5 seeds) plus `npm run simulate` at
BOTH horizons (run-time targets 4-9), with the 30K read for the quality/population trajectory
only. The PR quotes the simulate runs per the game-logic rule; a failed conservation identity
blocks the merge. Build gate `npm run build` (`tsc && vite build` — the Tailwind doc-scan trap
only surfaces here). New harness metrics (T9) exist because quality, abandonment-cause and the
delivery pump would otherwise hide inside aggregates. Scoped `npm run mutation` over the changed
`lib/` files is the overnight batch, not an in-session gate. No equilibrium tuning is licensed —
calibration is to the coarse health bar (no NaN/runaway/pinning; dispersion; liquidity), per the
evidence's own Licenses lines.

### Doc fold (on the branch, before the final review)

- `docs/SPEC.md`: substrate/body model, colonisation floor, population growth, surfaces — and
  the system interaction map rows touching space/habitability.
- Active docs: grep `docs/active/` for `habitableSpace`, `generalSpace`, `garden_world`,
  `availableSpace`, `habitable` at fold time and rewrite in present tense (colonisation.md's
  floor language at minimum — it is referenced from `expansion.ts`'s header).
- `docs/ROADMAP.md`: delete the habitability-seeding row; the events-revisit row (line 77) and
  charter-pricing lever (line 43) stay — they are this feature's named deferrals.
- This working file is deleted on the PR that ships the feature. Before deletion, re-run the
  grep-for-deferrals check: everything this file defers is either in the roadmap (events
  revisit, charter pricing, horizon re-pick at ROADMAP:516) or in Not covered below.
- Memory: the `temp/habitability-census.ts` / `temp/space-utilisation-diag.ts` pointers retire
  when T6 lands; the MEMORY.md in-flight paragraph retires at ship.

### Not covered

- **Charter/concurrency pricing** — booked: ROADMAP:43 (the split-off pacing lever).
- **Technology / terraforming unlock flow** — dropped here by spec ("locks only release", unlock
  = re-aggregate is stated interim `[PENDING: technology]`); no unlock code path is built.
- **Events coverage dilution (~2.5× felt-rate drop)** — booked: ROADMAP:77 events-revisit row;
  accepted this pass by owner quote.
- **Stale `economyType` on future unlock** — dropped with the same `[PENDING: technology]`
  label the spec carries.
- **Topology/blockade-aware colonist routing** — dropped: claim-4 evidence kills the worry for
  this change; a future routing layer owns it.
- **Danger badge re-cut** — booked at Gate A (merge-condition text names it).
- **High-percentile development refs** — booked at Gate C (the spec's pre-booked fix, applied
  only on a health-bar breach).
- **Simulate horizon re-pick** — booked: ROADMAP:516-520 owns re-picking both horizons; this
  plan reads the existing 1K/10K meanings as pre-founding/founding-era throughout.
- **Second pop type / demand-side quality coupling / stations / per-body population** — not
  claimed by the spec; the preference lookup ships with one row.

### Net-new UI

One item: `habitability-tooltip-content` (T14) — the fill-order decomposition block (per-body
score, people land, occupancy, frontier marker) inside the Population tab's growth-line tooltip.
Everything else composes existing `components/ui` pieces or re-cuts existing components in place
(`BodyCard`, the industry land bars). This list goes to Kai before `/implement-plan` starts.

### Self-review record (2026-08-23)

Checklist run by the author against the finished plan. Every named identifier grep- or
read-verified this session (receipts in the resolution table); reader-set floors walked with
`npm run impact` for `habitableSpace` (22 modules), `generalSpace` (18), `availableSpace` (7) and
the `yield*` sibling family for the new `extractionEfficiency` columns. Spec-to-plan diff: every
§1-§9 behaviour and §7 re-anchoring lands in a named task; the spec's deferrals land in Not
covered with bookings verified in the roadmap by line number. Material findings fixed during the
review: the abandonment change's newborn-guard interaction checked against real constants
(`ABANDON_POP_FLOOR` 1 < `COLONY_SEED_POP` 2 — safe); the harness-reads task moved into Stage 2
so Gates B-D can read the metrics they gate on; the save bump pinned to T2 with the
one-shipped-bump rule stated. No task contains code, branch logic or a derived formula — the
deposit-count derivation and score table are spec-authored and carried verbatim.
