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

### Terminal falsifier

At the t=0 generation census (whole-galaxy cohort, default 600-system preset): if **fewer than
~40% of systems carry any habitable body**, and **systems with 2+ habitable bodies are under
~10%**, then the mix is not inverted, premise 1 is false, and the retune direction dies —
the felt problem would have to be coming from somewhere other than the seeding mix (e.g.
founding eligibility or pacing), and the design restarts from that evidence.
