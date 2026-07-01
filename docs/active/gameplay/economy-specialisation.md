# Economy Specialisation S1 — Skill-Tiered Labour

> **Status: Active (shipped)** — stage **S1** of the four-stage Economy Specialisation track. Sits inside
> **SP5 autonomic-light**: every lever works *through* the existing autonomic build planner and physical
> economy tick — no faction-agency dependency. Track vision + the still-planned stages S2–S4 live in
> [economy-specialisation.md (planned)](../../planned/economy-specialisation.md); roadmap home is
> [economy-simulation-vision.md](../../planned/economy-simulation-vision.md) §13.

---

## Key mechanics (the headline)

A matured galaxy flattens: every developed system can make everything, so there is nothing to trade.
Tier-0 extraction already resists this — **deposits** are a hard geographic gate, so no system mines what
isn't in its ground. Tier-1+ manufacturing had **no equivalent gate** (it needed only labour + space, both
fungible), so it self-supplied everywhere and the price gradient collapsed.

S1 gives manufacturing its own gate: **it costs *skilled* labour that a system must physically build the
capacity to license.**

> A good's staffing requirement is a per-good **3-grade vector** `(unskilled, skill1, skill2)` that
> **partitions** its head count — it does not add to it. Advanced manufacturing is skill-heavy; extraction
> is light and unskilled. Two **academy buildings** raise a *ceiling* on how much of the existing
> population may work at each skilled grade. A frontier world with population and space but **no academies
> cannot run manufacturing at all**, no matter how big it grows.

Because skill is a *ceiling on existing labour*, population stays a **single scalar** (the vision §4
keystone — population is a magnitude, not a roster of people). Skill is not a kind of person.

---

## The merged factor model

Labour partitions the head count (the three shares sum to the total — a 1000-head fab is 1000 people
composed as e.g. 600 unskilled / 300 technicians / 100 engineers, *not* 1000 + 300 + 100):

- **Tier-0** (extraction / automated processing) — unskilled only.
- **Tier-1** (basic manufacturing) — mostly unskilled + a technician (skill-1) share.
- **Tier-2** (advanced manufacturing) — unskilled + technicians (skill-1) + engineers (skill-2).

```
// per good, labour PARTITIONS the head count:
labour_b = (unskilled_b, skill1_b, skill2_b),   Σ = labourTotal_b

// 1. Headcount gate — one aggregate gate; the bodies must physically exist (UNCHANGED from the scalar model).
labourDemand = Σ count_b × labourTotal_b
labourFulfil = min(1, population / labourDemand)

// 2. Skill-ceiling gates — per grade; academies license how much labour may work skilled.
skill1Demand = Σ count_b × skill1_b       skill1Cap = Σ vocationalSchools  × SKILL1_PER_SCHOOL
skill2Demand = Σ count_b × skill2_b       skill2Cap = Σ researchInstitutes × SKILL2_PER_INSTITUTE
skill1Fulfil = min(1, skill1Cap / skill1Demand)   // 1 when nothing demands skill-1
skill2Fulfil = min(1, skill2Cap / skill2Demand)

// each good is gated by ALL pools its tier draws on (effectiveFulfilment):
//   tier-0: labourFulfil  |  tier-1: min(labourFulfil, skill1Fulfil)  |  tier-2: min(…, skill1Fulfil, skill2Fulfil)
output_b = count × outputPerUnit × effectiveFulfilment(tier_b) × yield
```

The three-part `LabourState` is computed **once per system** and reused across all its goods
(`computeLabourState` / `labourParts` in `lib/engine/industry.ts`); `effectiveFulfilment(state, tier)`
picks the pools a good's tier actually draws on.

**Two academy buildings, one per grade** — a **vocational school** (licenses skill-1) and a **research
institute** (licenses skill-2). Each eats general space and draws *unskilled* head count to run (adds to
`labourDemand`), and raises its pool's ceiling. They do **not** require skilled labour to staff — otherwise
you'd need an academy to staff an academy; instructors are abstracted into the licensing function.

**The development ladder falls out for free.** Because tier-2 goods draw skill-1 labour too, a system
cannot run tier-2 without *both* a research institute and the vocational capacity its technician share
demands — no explicit "institute requires school" prerequisite is needed. Becoming a tech hub costs space +
population on *both* academy tiers *and* the labs, so a specialised system physically can't also be broad →
it imports the rest.

**Per-good space cost.** `spaceCost` varies by good — the most-integrated tier-2 factories (shipyards,
foundries) are large, so you physically can't fit the whole tier-2 basket on one body. This differentiates
**general-space** footprints (the land factories + housing compete for); tier-0 extractor footprint stays
on the deposit-slot model, capped by deposits rather than general space.

---

## How the pieces interact

The `LabourState` threads through every consumer of the production math, so the skill gate is applied
identically on the live tick, the simulator, decay, the seed, and the forecast:

- **Production** (`buildingProduction`, both tick adapters, `capacityGoodRates`) — output uses
  `effectiveFulfilment(tier)` instead of the old scalar `labourFulfillment`.
- **Demand forecast** (`totalDemandRateForGood` / `inputDemandForGood`) — the input-draw term is
  skill-gated too, so a tier-1/2 system with **no academy** correctly forecasts **zero** (not phantom)
  input demand. The population adapters compute the `LabourState` once per system and pass it in.
- **Infrastructure decay** (`computeSystemDecay`) — an academy's own `used` is how much of ITS licensed
  capacity the system draws on: `count × min(1, skillDemand / skillCap)`. An academy licensing more than
  the system needs sheds the excess; one orphaned by a contracted hub (`skillDemand → 0`) decays away
  entirely — the same single decay rule as production and housing, which keeps academies concentrated at
  genuine hubs. A tier-1/2 factory that is head-count-full but skill-starved reads as idle and rots too.
- **Industry readout** (`buildIndustryReadout`) — a new `"skill"` idle reason names the binding
  constraint when a skill ceiling (no academy) drags `effectiveFulfilment` below the head-count gate.

### Autonomic build — the academy as a buildable labour gate

The planner (`lib/engine/directed-build.ts`) only builds capacity that serves a *reachable structural
deficit*, gated by `min(space, served-demand, budget, labour)`. An academy produces no good, so it would
never be built on its own — and the skill gates would then silently suppress manufacturing everywhere. The
fix: **the skill ceiling is a *buildable* labour gate.** When the industry pass commits to a skill-gated
good and a skill ceiling binds, it **co-builds the academies needed to lift that ceiling first, charged to
the same opportunity** — spending the same budget + space + spare-labour pool — then builds the production
with what's left. The academy is valued **transitively**: its worth is exactly the deficit-serving output
it unblocks (no speculative academies). Sizing iterates to convergence so production + academy lift fit all
three constraints; tier-0 (no skill draw) never co-builds an academy.

### Seed

`allocateIndustry` (`lib/engine/industry-seed.ts`) seeds academies sized to exactly cover the placed
factories' skill draw, charged to the same factory budget — without them every seeded tier-1/2 building
would produce nothing (caps start at 0). The staffing self-consistency pass scales academies down
alongside production, so licensed skill capacity stays matched to the reduced skill demand.

---

## Constants (coarse first-cut — calibrated once, after the whole track)

All magnitudes are first-cut and simulator-tunable; the real calibration is **one pass once the structural
track (S1–S4) is in**, per the coarse-health-calibration principle — numbers are perishable, the *structure*
is the commitment. In `lib/constants/industry.ts`:

- `LABOUR_BY_TIER` — per-tier default partition; `LABOUR_OVERRIDES` where a good reads differently
  (engineer-heavy shipyards, labour-heavy consumer goods).
- `SKILL1_PER_SCHOOL`, `SKILL2_PER_INSTITUTE` — licensing per academy (large, so one academy serves several
  factories → academies stay lumpy/concentrated).
- `SPACE_OVERRIDES` — per-good general-space footprint for the biggest tier-1/2 factories.
- `INPUT_DEMAND_MULTIPLIER` — magnitude knob on recipe input-demand draws (neutral `1.0` until calibrated).

---

## Scope boundaries

**In (S1):** per-good 3-grade labour vector; two academy building types + skill-ceiling gates threaded
through production / forecast / decay / seed / build; per-good general-space cost; `INPUT_DEMAND_MULTIPLIER`
knob; the `"skill"` idle reason + academies group in the Industry panel.

**Deferred (later stages of the track, all agency-free):**
- **S2 — specialisation complexes** (anchor buildings: built comparative advantage + economies-of-scale).
- **S3 — demand concentration** (civilian consumption by system character, not flat per-capita).
- **S4 — guardrails & tuning** (build-pacing, tier-scaled decay, diffusion friction) — tuned *last*,
  against the real gradient the structural stages create.

**Genuinely deferred (downstream, unchanged in sequence):** full faction agency (treasury /
doctrine-weighted build / directed-logistics orders), the contract-model rework, ship re-pricing, events,
war. Demographic skilled labour (skill as a *kind of person* who migrates to jobs) stays a deliberately
deferred *alternative* endpoint — not a worse version of this — see the planned track doc.

---

## Where this sits in the roadmap

- **Superseded** the build plan `docs/build-plans/s1-skill-tiered-labour.md` (now deleted).
- **Expands** the `economy-scaling-and-trade-rework.md` "2a — preserve a spread" item into a structural
  specialisation track; the contract-model rework depends on the spread this track creates.
- **Next:** the S1→S2 **Economy UI legibility** interstitial (surface skilled-labour pools + per-factory
  binding constraint + building descriptions — tracked in `docs/BACKLOG.md`), then S2 anchors.
