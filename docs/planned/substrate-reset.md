# Substrate Reset — Monthly Pulse, Emergent-Civ World-Gen & Colonisation

Status: **Designed, not yet built.** Design spec for the first build phase after the single-player
runtime (SP0 in this phase's own decomposition). Precedes the player seat. Each part below ships as
its own PR; the implementation plan lives in `docs/build-plans/` once written.

---

## Headline

Before we build the player seat, we reset the two parts of the simulation substrate that were shaped
by constraints we no longer have — the **tick cadence** (shaped by the old database) and the
**starting condition** (a pre-populated, fully-owned galaxy that skewed every calibration). Three
coupled changes, calibrated **once**, against the regime we actually ship:

1. **Monthly pulse.** The economy and all faction-scale accounting resolve **once per month for the
   whole galaxy at once**, in dependency order — the Stellaris/Victoria model — instead of a
   per-system round-robin smeared across 24 ticks. Continuous, cheap things (ship movement, event
   progression, trade diffusion) keep running every tick so the map stays alive. `24 ticks = 1 month`.
2. **Emergent-civ world-gen.** Each faction starts as a **single developed homeworld** in a
   **mostly-empty galaxy**, seed-biased to a decent home and spaced apart. Major/minor status is no
   longer seeded — it **emerges** from how each civilisation expands.
3. **Control & colonisation.** Factions grow by claiming territory along a three-state model —
   **unclaimed → controlled (cheap outpost) → developed (expensive space-station facility)** — with
   **ranged-but-bounded** expansion and a **logistics penalty for crossing unowned space** that makes
   poorly-connected empires function worse, so filling in the gaps is an organic incentive rather than
   a rule.

**Why now, and why together:** the world-gen inversion is the single biggest thing that invalidates
economy calibration, and it was scheduled last. Doing it *before* the player seat means every later
slice is built and tuned against the real growth-from-small regime instead of a pre-populated
equilibrium we were about to delete. The pulse change and the world-gen change both move the
calibration target, so we make both, then do **one** coarse sanity pass — not a precise tuning pass
(precision is deferred; the flow-merge and construction-goods economy re-point will move it again).

---

## Where this sits in the roadmap

The grand-strategy re-conception (`grand-strategy-vision.md` §8) sequences: Phase 2 (single-player
runtime, shipped) → Phase 3 (player seat) → Phase 4 (pops/ideology/control + flow-merge + goods
re-point). This substrate reset is a **preparatory phase inserted before the player seat**, pulling
the world-gen inversion and colonisation forward out of Phases 3–4 for the calibration reason above.

The full local decomposition of "the player seat" work is:

- **SP0 — Substrate reset** *(this doc)* — monthly pulse · emergent-civ world-gen · control/colonisation · one coarse calibration + profiling.
- **SP1 — Player seat + control surface v1** — pick a faction; per-domain automation toggles + priority/budget levers over the existing autonomic layer; the command-queue-on-`World` + tick-application plumbing. On the new substrate.
- **SP2 — Manual placement + build orders** — direct fractional placement, queued build orders, and **player-directed colonisation verbs** (the colonisation *mechanism* already exists from SP0; SP2 lets the player aim it).
- **SP3 — Economy re-point (Phase 4 economics)** — goods → construction/pops channels; **construction-goods cost** on colonising/building; the diffusion + directed-logistics **flow-merge**; the second (smaller) recalibration.
- **SP4 — Alert feed** — faction alert strip over the existing event/SSE substrate.

`grand-strategy-vision.md` §8 should be reconciled to reflect this reorder.

---

## Locked design decisions (with rationale)

These were settled during brainstorming; recorded so the reasoning survives.

| Decision | Rationale |
|---|---|
| **Global synchronized pulse, not round-robin** | Most legible model (one coherent monthly snapshot the player can reason about, and the alert feed / monthly report can build on). Round-robin was a DB-throughput hack, not a correctness need — Paradox uses it only as invisible CPU amortization. |
| **Round-robin/amortization kept only as a profiling-gated fallback** | Order-independence holds either way in our architecture (see below), so synchronized-vs-amortized is a pure performance dial with **no gameplay/fairness cost** — we only reach for amortization if profiling a whole-galaxy pulse hurts at large scale. |
| **Two-rate (daily heartbeat + monthly pulse)**, not single-rate | We already effectively have two rates. The daily clock carries only cheap continuous work; it never touches the economy. Keeps the map smooth without running the economy every tick. |
| **`24 ticks = 1 month`** | Each system's economy already resolves every 24 ticks, so a 24-tick month keeps the per-system magnitude-per-resolution unchanged — only staggered→synchronized changes. Minimises the calibration delta from the cadence change alone. |
| **Single developed homeworld per faction; galaxy mostly empty** | Maximises the growth-from-small regime (the whole reason to invert world-gen now). A pre-developed core region would partly re-create the pre-populated equilibrium we're escaping. |
| **Major/minor status emerges from expansion** | Fits the "emergent civilisations" framing — dominance is earned on the map, not seeded. The faction roster stays as *identities* (names, governments, doctrines) only. |
| **Ranged expansion, bounded to a reach radius** | Ranged is the richer choice and enables the interim-system / connectivity play. Bounded because unbounded claim-scoring is O(factions × all systems) each pass — the reach radius bounds it to O(factions × local). |
| **Control/colonise split (outpost vs station)** | Load-bearing for the connectivity design: a cheap "just claim it" tier is what lets you grab interim connector systems without developing them, which is what rewards connectivity. Without the split there's no incentive structure. |
| **Logistics penalty for crossing unowned space** | The mechanic that makes poorly-connected empires function *worse* (the Paradox feel) without a hard rule — supply reaches disconnected territory, just badly, and claiming the gaps buys back efficiency. |
| **Shared build-point pool for expand + develop** | Cheap outpost / expensive station / existing build costs all draw one pool → organic tall-vs-wide tension, no new cost machinery. |
| **Calibration is coarse-only this phase** | Precision calibration is perishable and the flow-merge + construction-goods re-point (SP3) will move the target again. This phase only checks "nothing broken / runaway". |

---

## 0a — Tick model: monthly pulse

### Two clocks

- **Daily heartbeat** — every time the tick loop runs (`runWorldTick`). Carries only cheap,
  continuous work.
- **Monthly resolution pulse** — every `MONTH_LENGTH = 24` ticks (currently `ECONOMY_UPDATE_INTERVAL`).
  Carries the whole faction-scale accounting stack, for the **entire galaxy at once**.

### Processor classification

| Runs **daily** (every tick) | Runs **monthly** (on the pulse, whole galaxy, in dependency order) |
|---|---|
| ship arrivals · event phase progression · **trade-flow diffusion** | economy → infrastructure decay → population → migration → directed logistics → directed build |

Trade-flow stays daily so goods visibly diffuse between resolutions (the map's "aliveness" comes from
the daily clock, not from staggering the economy). Migration is **monthly** — it rides the pulse with
the population it depends on. Directed logistics and directed build move **off** their 48-tick agency
clock onto the monthly boundary (this ~doubles their frequency vs. today — the one genuine rate change
to re-tune in 0c).

### Synchronized, in one coherent run

On a pulse tick, each monthly processor runs over **all** systems in dependency order (processor-major:
economy for the whole galaxy, then decay for the whole galaxy, …). Every faction is fully resolved by
the end of the pulse, reading a single consistent "as of last month" snapshot. No system's resolution
reads another's mid-update.

### Why synchronized is safe (order-independence)

The "some factions act first with new resources" hazard requires a **shared mutable pool contended
within a cycle**. Our architecture has none:

- **Economy resolution is local-per-system** — production/consumption/stock/price read only that
  system's own state; the sole cross-system coupling is trade-flow, a separate processor. So running
  every system's economy on one pulse is naturally order-independent.
- **Directed logistics and directed build are intra-faction** — a faction's haul/build touches only
  its own systems; two factions cannot contend regardless of order.
- **Trade-flow is iterative diffusion** — small deltas that converge whatever the edge order, and it's
  on the daily clock anyway.

The **one** genuine contention is **colonisation claims** (two factions targeting the same unclaimed
system) — handled by explicit two-phase claim resolution (see Mechanic details), not shard order.

Because order-independence holds regardless, if 0c profiling shows the whole-galaxy pulse spikes too
hard at 10–20k systems we may **spread the resolution across the month's days** as a pure performance
optimization, with no gameplay consequence. Default is synchronized; amortization is the fallback.

### Speed dial

The existing `paused | 1 | 5 | max` dial paces **days/sec**; a pulse lands every 24 days. Max speed
remains a CPU-bound yielding loop; the monthly pulse is the heaviest tick and self-paces there.

---

## 0b — Emergent-civ world-gen + control/colonisation

### Starting condition

- **One developed homeworld per faction**; every other system starts **unclaimed** (`factionId: null`,
  no population, no buildings, no markets stock beyond generation defaults).
- **Seed bias** — homeworlds are chosen for good substrate: sufficient habitable fraction, resource
  diversity across deposit slots, and low danger. No faction starts on a dud.
- **Min-distance spacing** — faction homeworlds are placed with an attempted minimum spacing (spatial
  or jump-distance), with **graceful relaxation** when a small/dense galaxy can't satisfy it (relax the
  threshold rather than fail).
- **Player spacing is free** — no player exists at gen time; because *every* faction homeworld is
  spaced, whichever faction the player picks in SP1 is spaced from the AI by construction.
- **Emergent status** — all factions start equal (one decent homeworld). The 8-major + minor roster
  supplies identities (names, governments, doctrines) only; **major/minor status emerges** from the
  existing share-of-territory derivation as factions expand. Minors get the same single-homeworld
  treatment.

This replaces the current BFS flood-fill that claims 100% of systems (`assignSystemFactions`) with
homeworld placement only; the nullable `factionId` and its downstream null-handling already exist and
are exercised for the first time here.

### Three ownership states

| State | Marker | Meaning |
|---|---|---|
| **Unclaimed** | `factionId: null` | Empty frontier. No owner, no development. |
| **Controlled** | `factionId` set + an **outpost** building | Cheap sovereignty. It's your territory, closes the border, and **routes logistics cleanly**. No population or industry. The interim-connector tier. |
| **Developed** | outpost + a **space-station facility** building | The facility unlocks housing/industry/settlement construction; the normal autonomic build (housing → population → labour-gated industry) then grows the system. The investment tier — paid only where you actually want production. |

A controlled-but-undeveloped system is territory + a logistics waypoint; it produces and consumes
nothing until developed.

### Ranged, bounded expansion

- Expansion is **ranged** (leapfrog allowed) but bounded to a **reach radius** — unclaimed systems
  within `REACH_JUMPS` (~3–4, tunable) of a faction's existing territory. This bounds claim-scoring to
  a local neighbourhood (performance) while allowing a gap or two to be jumped.
- The claim-scorer reads a **"systems in reach"** set from a provider. Today the provider returns
  "within `REACH_JUMPS`, full information." This is the seam through which **fog-of-war** (a later,
  separate sub-project) will later return "within sensor coverage, with far systems carrying only
  *fuzzy* traits" — no rework of the scorer required.
- A faction claims when it has spare capacity in the shared pool, preferring the highest-scoring
  in-reach target — score = substrate potential **discounted by the connectivity penalty** it would
  incur (so a system it cannot supply scores low, and overreach self-regulates).

### Connectivity via a logistics penalty

- **Passive diffusion stays local** — it equilibrates markets within connected owned territory
  (edge-local, both endpoints share a faction), unchanged this phase.
- **Directed logistics gains cross-unowned routing** — it may route a haul across **unowned space**,
  but each unowned-transit hop takes a **heavy penalty** on top of the existing distance attenuation.
  A disconnected enclave *can* be supplied, just badly.
- Claiming interim systems as **outposts** converts penalised unowned-transit into clean owned
  routing → an efficiency jump. **That is the gap-filling incentive, expressed mechanically.**

The full diffusion + directed-logistics **merge** into one flow system (the vision's "one
player-legible flow system") is **deferred to SP3**, where techs/lanes/buffs and the recalibration
already live. The per-unowned-hop penalty logic ports directly into the merged system, so this phase's
minimal change isn't throwaway.

### Cost model

A single shared capacity pool — the existing build-point budget (`Σ population × GENERATION_PER_POP`).
Three cost tiers draw from it:

- **Outpost** — cheap.
- **Space-station facility** — much more expensive.
- **Development buildings** (housing, extractors, factories, academies, complexes) — existing costs.

So expanding, unlocking, and developing all compete for one pool → **tall-vs-wide** tension for free,
and overreach costs growth at home. The pool becomes **money + resource requirements** in SP3; no
money model is introduced now.

---

## 0c — Profiling + coarse sanity (not a tuning pass)

- **Profiling** — run the calibration harness (`npm run simulate`, `runWorldTick`) at 600 / 5k / 20k
  systems against the **new** regime; measure the monthly-pulse cost and max-speed throughput. This is
  the max-speed profiling the vision booked (§5.5).
- **Coarse sanity only** — validate intrinsic health, not precise balance: no `NaN`/`Infinity`/runaway,
  no pinning, greedy ≫ random, growth from small cores is *coherent* (systems expand and develop
  without collapse), the galaxy fills **partially** (physical ceilings leave negative space intact).
  Precision tuning is deferred — it's perishable and SP3 moves the target again.
- **Markets are the prime perf suspect.** The pricing/anchor/band apparatus was built to price player
  arbitrage; as a pure cost signal it's over-built, and under a synchronized pulse every market
  recomputes on the pulse. If profiling confirms markets are the bottleneck, the targeted lever is
  **simplifying the per-market price *computation*** (a cheaper formula) — which is **distinct from**
  the SP3 "re-point what demand means / goods roster" work and requires none of SP3 pulled forward.

---

## Mechanic details (to pin in implementation, sensible defaults proposed)

- **Outpost & station as building types** — add an outpost type (control marker; non-producing; enables
  clean logistics routing; cheap) and a space-station-facility type (development gate; enables the
  other build types in-system; expensive) to the building catalog (`lib/constants/industry.ts`).
  Existing build types become **gated** on the facility's presence in a system.
- **Colony population bootstrap** — logistic growth cannot start from zero, so founding a colony
  (building the facility) must seed a starter population. **Proposed:** transfer a small **seed
  population from the nearest core system** (conserved — settlers come from somewhere, fitting the
  physical/emergent ethos), which then grows locally and is supplemented by ordinary migration.
  Alternative considered: spawn colonists ex nihilo (simpler, non-conserved). Recommend the conserved
  transfer.
- **Deterministic claim resolution** — expansion runs inside the monthly pulse. To avoid FCFS-by-faction
  order, resolve claims in **two phases**: (1) each faction proposes its desired claim(s) for this
  pulse; (2) conflicts (multiple factions targeting one system) resolve by highest claim-score, ties
  broken by seeded `tickRng(seed, tick)` — never by processing order. Then apply.
- **Reach provider seam** — `systemsInReach(factionId): SystemView[]` returns in-reach candidates. This
  phase: within `REACH_JUMPS`, full traits. The fog-of-war sub-project later swaps the provider to
  sensor-coverage + fuzzy far traits.

---

## What changes in code (grounded pointers, not the build plan)

- **Tick model** — `lib/world/tick.ts` (`runWorldTick`): gate the six monthly processor blocks behind
  a `tick % MONTH_LENGTH === 0` check and feed them the **whole galaxy** (drop the per-system economy
  shard-selection and the 48-tick logistics/build phase offset); leave ship-arrivals, events, and
  trade-flow running every tick. `MONTH_LENGTH` from `lib/constants/tick-cadence.ts`.
- **World-gen** — `lib/engine/faction-gen.ts` (`assignSystemFactions`, `enforceMinorMinimum`): replace
  flood-fill ownership with homeworld placement only (seed-biased + min-distance spaced), leaving the
  rest `factionId: null` and unpopulated. `lib/world/gen.ts` (`generateWorld`) and
  `lib/engine/universe-gen.ts` (`selectStartingSystem`) adjust the starting-condition seeding.
- **Ownership/building types** — `lib/constants/industry.ts` (outpost + station types, build-gating);
  `lib/world/types.ts` (any new marker fields, if a boolean/enum is cleaner than a building row).
- **Expansion mechanic** — extend directed build (`lib/tick/processors/directed-build.ts`,
  `lib/engine/directed-build.ts` `planFactionBuilds`) with a claim step (propose → resolve → apply,
  `null → factionId` + outpost), the reach provider, and the shared-pool cost tiers.
- **Cross-unowned logistics** — `lib/tick/processors/directed-logistics.ts` /
  `lib/engine/directed-logistics.ts`: allow routes through unowned systems with a per-unowned-hop
  penalty; route cleanly through owned (even outpost-only) systems.
- **Save version** — bump `SAVE_FORMAT_VERSION` (`lib/world/save.ts`); any `World`-shape change
  invalidates saves by design (pre-1.0).
- **Constants** — `lib/constants/tick-cadence.ts` (month length), new outpost/station/reach/penalty
  constants in the relevant `lib/constants/*` files.

---

## PR breakdown

1. **Monthly pulse refactor** — tick-model change (0a). Mechanical; verify no `NaN`/runaway on the
   *current* world (correctness, regime-independent) before the world content changes.
2. **World-gen inversion + outpost/station + build-gating** — starting condition (0b) + the three-state
   ownership model + expansion claim step, capacity-bounded from the shared pool.
3. **Penalised cross-unowned logistics + profiling/coarse-sanity pass** — the connectivity lever (0b) +
   0c.

---

## Explicitly deferred (not this phase)

- **Diffusion + directed-logistics merge** into one flow system → SP3 (with techs/lanes/buffs).
- **Logistics lanes / throughput / range techs & buffs** → SP3+.
- **Construction-goods cost** on colonising/building (the pool stays free build-points) → SP3.
- **Money / treasury** → SP1/SP3.
- **Player-directed colonisation verbs** (player aims expansion) → SP2. Expansion is AI-only this phase.
- **Fog-of-war / tiered sensor information** (fuzzy-far / precise-near) → its own planned sub-project;
  the reach-provider seam is left ready for it.
- **Precision economy calibration** → after SP3's re-point (one calibration, once the target stops
  moving).
