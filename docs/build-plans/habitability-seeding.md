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

### Terminal falsifier

At the t=0 generation census (whole-galaxy cohort, default 600-system preset): if **fewer than
~40% of systems carry any habitable body**, and **systems with 2+ habitable bodies are under
~10%**, then the mix is not inverted, premise 1 is false, and the retune direction dies —
the felt problem would have to be coming from somewhere other than the seeding mix (e.g.
founding eligibility or pacing), and the design restarts from that evidence.
