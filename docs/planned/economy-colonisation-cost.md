# Colonisation Cost & Viability — Pool-Funded Expansion (Core Model Rework)

> **Status:** Design (validated by brainstorm 2026-07-10). Replaces the deliberately-lazy free/instant
> colonisation stopgap with a real, temporary-but-proper mechanic: expansion is **funded from the shared
> construction pool** and **timed**, and every colony is **viable by construction** (lands with the seed
> population and housing for it). Sits inside the demand-driven rework
> (`docs/planned/economy-demand-driven-model.md`) as the sub-project **between B+C (rate placement + planner
> seam) and D (homeworld prefab)** — a colony run through the old free-develop still floods, so this must
> land before the prefab. No code yet — this design spawns an implementation plan.

## Headline

A faction no longer flips a controlled system to `developed` for free, instantly, once per pulse. **Developing
(settling) a system becomes a pool-funded, multi-pulse "establish colony" project** — the same throughput pool
and funding queue that build housing and industry. Expansion therefore **competes with build-out for one scarce
resource**, so a faction that is busy developing its worlds cannot also keep grabbing new ones: the planner
self-limits without a magic cap. When an establish project **completes**, the system flips `developed` and lands
**viable by construction** — the conserved seed population *and* enough housing to house it, sized to the land —
so the stranded-pop state (pops on a `popCap≈0` world) cannot occur. The planner decides expand-vs-build by
comparing **value ÷ pool cost** on a single axis, where a colony's value is *not* just the current demand its
deposits could serve but also the **option value of the land itself** (new habitable land → future pop → future
economy), gated so it only outweighs marginal home building once existing territory is filling up. The shared
pool is the stand-in for the eventual **money + goods + construction/logistics resources**, so the comparison we
build now is the one the real resource economy will make later.

## Motivation — why now

Colonisation was built as a stopgap: claim and develop are **free, instant, and capped only at one develop per
faction per 48-tick pulse**, completely decoupled from construction capacity. Three failures follow, and they
compounded to make the rate-placement bug (B) far harder to diagnose — a colony was failing for two reasons at
once:

- **Expansion outruns construction.** A faction spawns a colony every pulse whether or not it can ever build it
  out; colonies pile up undeveloped (pops, no housing, no industry).
- **The seed transfer wrecks the source.** Each develop yanks a conserved `COLONY_SEED_POP` off the nearest
  developed system, temporarily denting the homeworld's population every pulse.
- **Nothing is built for the seed pops.** With develop instant but construction funded, the colony's housing may
  never be funded, stranding the transferred population on a `popCap≈0` world.

The fix is not another local patch. It is to make expansion **cost the scarce thing** (the construction pool) and
make a colony **viable the moment it exists**.

## The model

### 1. Claim stays cheap; develop becomes the funded project

**Claiming** a system (unclaimed → `controlled`, staking a border) stays cheap and near-instant in this slice — it
is just drawing the territorial line, still bounded by reach (`EXPANSION.REACH_JUMPS`) and the small per-pulse claim
cap. **(Deferred seam:** later, control may itself become a scan + outpost project, Stellaris-style — see Deferred.)

**Developing** a controlled system (`controlled` → `developed`, actually settling it) becomes a **construction
project** of a new kind — a *colony-establishment* project — funded from the same per-faction throughput pool and
front-of-queue funding machinery as buildings (`fundQueue`). It carries a work total (`COLONY_ESTABLISH_WORK`),
accrues work over pulses, and the system flips to `developed` only when the project **completes**. This is the
"timed, costs the scarce resource" property: the establish cost is paid in the currency of *forgone building*, and
it spreads over multiple pulses — that spread **is** the establish time. `MAX_DEVELOPS_PER_PULSE` (the old instant
cap) is retired; the pool cost paces develop now.

### 2. Viable by construction — seed pop + bundled housing

An establish project **completes into a viable colony in one atomic step**:

- The conserved seed population is transferred from its source (unchanged conservation: `moved = min(seedPop,
  source.population)`, deducted from the source).
- **Housing is placed sized to house that seed population** (`housing = ceil(seedPop / POP_CENTRE_DENSITY)`),
  bounded by the colony's habitable land. So `popCap ≥ seedPop` on arrival — there is no `popCap≈0` stranded state.
- **The seed population is sized to what the land can house**: `seedPop = min(COLONY_SEED_POP, habitableCap(c))`,
  where `habitableCap(c)` is the population the colony's habitable land could ever house. A land-poor system takes
  a proportionally smaller seed (and its source keeps the rest). A system with no habitable land is not a develop
  candidate at all (the existing `DEVELOP_HABITABLE_FLOOR` gate stands).

The bundled housing is part of the establish project's deliverable, not a separate build — the colony is
*created* with it. After it exists, ordinary demand-driven construction (B) takes over: the colony's own rate
deficits become normal build opportunities, and the pool flows into building it out.

### 3. Valuation — expand-vs-build as ROI on one pool

Because both a build and a colonisation draw the shared pool, the planner funds **whichever returns more value per
unit of pool**. Builds are already scored in demand-rate units (served rate deficit ÷ work cost). A colony is
scored on the same axis with **three terms**:

```
Value(c) = U(c)  +  L(c) · ( σ_floor + (1 − σ_floor) · σ(F) )
ROI(c)   = Value(c) / COLONY_ESTABLISH_WORK
```

- **`U(c)` — unblocking value (demand-driven, always counts).** For each good the faction has a *structural rate
  deficit* in that **no existing owned developed system can build** (none has the deposit slots / general space +
  habitable land to staff it), credit the portion colony `c` *could* produce (it has those slots/space). In
  demand-rate units — directly comparable to a build's served value. Captures "the colony gives us a supply we
  physically cannot make today."

- **`L(c)` — land value (forward-looking option value).** `L(c) = LAND_PREMIUM × habitableSpace(c)` plus small
  secondary weights on general space and deposit richness (`LAND_GENERAL_WEIGHT`, `LAND_DEPOSIT_WEIGHT`). This is
  the value of land *itself* — new habitable land → future pop → future labour → future production **and** demand,
  compounding, independent of any current deficit. It is what pure demand-matching misses and why "colonising at
  all is inherently valuable."

- **`σ(F)` — territory saturation (the crossover driver), in [0,1].** `σ(F) = clamp(Σ builtHousingPopCap /
  Σ habitablePotentialPopCap, 0, 1)` across the faction's developed systems — *how much of the faction's habitable
  land is already committed to housing*. Low when there is lots of unbuilt habitable land at home (fill it first);
  high when existing territory is built out (new land is the only way to grow). Habitable land is the binding
  long-run constraint (it caps pop, which caps everything), so it is the honest "am I out of room" signal and it
  rides the same pop/growth curve as demand. The `σ_floor` term keeps a configurable share of the land value live
  *before* saturation — the land-grab instinct.

**Why this produces the intended behaviour:**

- **Early / ample home headroom:** the best home build serves a large deficit → high build ROI; `σ` is low so the
  land premium is mostly dormant → the faction **builds out home first** and does not grab land it cannot yet use
  (which scores near zero, so it will not wreck its own pop expanding prematurely).
- **Home saturating:** deficits shrink and remaining builds get remote/marginal → build ROI falls, and `σ → 1` →
  the land premium activates → **colonisation overtakes marginal industry.** The crossover *emerges* from the ROI
  comparison rather than a hard threshold.

### 4. Value-order funding (the need-order swap)

For the pool to actually flow to the higher-ROI project, the funding queue must fund **by value, not
front-first FIFO**. `fundQueue` (and the queue assembly in the directed-build processor) orders open + newly
proposed projects by descending ROI, then funds front-first within that order (finishing started work before new
commitments at equal priority, so in-flight projects still complete rather than starving under a churn of
higher-scored newcomers). This is the "FIFO → need-order" swap the demand-driven model already anticipated
(§5), and it is what lets build-vs-colonise arbitrate on the pool.

## Colony lifecycle (data flow)

```
unclaimed ─(cheap claim, reach-bounded)→ controlled
controlled ─(planner scores it as a colony candidate: ROI(c) vs the faction's build ROIs)→
  if it wins pool priority: a COLONY-ESTABLISH project is queued (work = COLONY_ESTABLISH_WORK)
  ─(funded from the shared pool over N pulses, value-ordered)→ project completes →
    system flips `developed`  +  seed pop transferred (conserved, sized to land)  +  housing placed for the seed pop
  ─(now a normal developed system)→ demand-driven build-out (B) fills its deposits/industry as ordinary opportunities
```

Every arrow after `controlled` is paced by the same pool, so expansion and build-out share one budget and one
value ranking.

## Architecture / where it touches

Colonisation becomes a **proposer that emits into the decision → gate → pace pipeline** — precisely the C4 seam
deferred from B+C, now with a concrete second consumer. Units and their boundaries:

- **`lib/engine/colonisation-value.ts` (new, pure).** `colonyValue(candidate, factionState, params)` computing
  `U + L·(σ_floor + (1−σ_floor)·σ)`. Inputs: the candidate's substrate (habitable/general/slotCap + qualities),
  the faction's structural deficits + which goods no owned system can build, and the faction saturation `σ`.
  Independently unit-tested; no I/O.
- **`lib/engine/directed-build.ts`.** The decision unit emits **colony-establish proposals** alongside build
  proposals (a discriminated `Proposal = BuildProposal | ColonyProposal`), each carrying its value and cost, so
  the gate/pace stages treat them uniformly. (This is where the C4 decision/gate split gets cut for real.)
- **`lib/engine/construction.ts`.** `fundQueue` orders by ROI (value ÷ remaining work) before funding; a
  colony-establish project is just another queue entry with a `workTotal`. On completion it emits a
  *colony-established* landing (not a building-count increment) that the processor turns into a develop + seed +
  housing mutation.
- **`lib/tick/processors/directed-build.ts`.** The develop phase no longer flips control instantly; it enqueues
  colony-establish projects (from the ranked proposals) and applies *completed* establishments — flipping control,
  transferring the (land-sized) seed pop, and placing the bundled housing — via the world adapter.
- **`lib/world/tick.ts` (`applyDevelopments`) + the develop adapter.** Extended so a landed establishment carries
  its housing placement, and the seed-pop transfer is sized to `habitableCap`.
- **`lib/constants/expansion.ts` / a new colonisation-cost constants block.** `COLONY_ESTABLISH_WORK`,
  `LAND_PREMIUM`, `LAND_GENERAL_WEIGHT`, `LAND_DEPOSIT_WEIGHT`, `SIGMA_FLOOR`, and (later) their per-doctrine
  overrides. `MAX_DEVELOPS_PER_PULSE` is retired.
- **`lib/engine/simulator/build-analysis.ts`.** Extend the colonisation metric already added in B/C to also report
  establish-projects in flight and pool split between build vs colonise, so the pacing is observable in
  `npm run simulate`.

## Bias & tuning seams (doctrine later — not built now)

The valuation is a **demand-ridden spine with orthogonal bias points**, all per-faction *inputs* (global calibrated
defaults now; a doctrine lookup feeds them later — the formula never changes):

- **`SIGMA_FLOOR`** — *when* the land premium turns on. `0` = tall/builder (expand only when saturated); `→1` =
  expansionist land-rush (grab space regardless of home state); default in between (steady clip, accelerating as it
  fills). This is the primary "expansionist vs not" dial.
- **`LAND_PREMIUM`** — *how much* a unit of land is worth. Raising it shifts every crossover earlier.
- **`COLONY_ESTABLISH_WORK` (cost)** — cheaper establish = more expansion per pulse.

When the doctrine/relations phase lands, wiring it in is "look up `{SIGMA_FLOOR, LAND_PREMIUM, costMult}` by the
faction's doctrine and pass them into `colonyValue`" — no math change. This is the same pacing seam the future
treasury attaches a money gate to.

## Deferred — with the seams that carry them

- **Treasury / money + goods + logistics resources** — the shared construction pool is their stand-in. Each becomes
  an additional *cost input* to the same establish project and an additional *gate* at the same pacing seam; the
  ROI comparison already has the shape (value ÷ cost) to fold them in.
- **Scan + outpost claim project** — later, `controlled` itself becomes a funded/timed step (a scan then an outpost
  build) instead of a cheap flip; it plugs into the same project/funding machinery as the establish project.
- **Doctrine expansion behaviour** — the three bias inputs above, fed per-faction.
- **Homeworld prefab (sub-project D)** — independent; runs *after* this so the prefab starts are colonised/built by
  the corrected mechanic.

## Testing strategy

- **Valuation crossover (unit):** a faction with a large unserved home deficit funds the home build over a colony
  (build ROI > colony ROI); a faction whose home territory is saturated (`σ→1`, no cheap deficits) funds the colony.
- **`σ_floor` spans the spectrum (unit):** `σ_floor=0` never expands until saturated; `σ_floor→1` expands with home
  headroom remaining — same candidate, opposite decisions.
- **Establish is timed + pool-funded (processor):** a develop does not flip control on the pulse it is proposed; it
  accrues work across pulses and flips only on completion; a faction with a tiny pool establishes slowly.
- **Viable by construction (processor):** a completed establishment lands `developed` with `popCap ≥ seedPop`
  (housing bundled); no developed system ever exists with population but `popCap≈0`.
- **Seed sized to land:** a land-poor colony receives a smaller seed and its source retains the remainder
  (conservation holds; total faction population unchanged by the transfer).
- **Value-order funding (unit):** given mixed open projects, `fundQueue` funds the highest ROI first; started work
  still completes rather than starving.
- **Determinism + serializability:** establishment is deterministic; no `NaN`/`Infinity` in world state; the
  colony-establish project round-trips through save/load.
- **Simulator health (`npm run simulate`):** expansion is paced (establish projects in flight, not a flood of
  instant colonies); colonies are viable (no populated-but-no-industry / popCap-starved); homeworld population is
  not repeatedly dented by seed transfers; greedy ≫ random still holds.

## Calibration note

Coarse health only, per the standing approach — first-cut coefficient values (`COLONY_ESTABLISH_WORK`,
`LAND_PREMIUM`, `SIGMA_FLOOR`, the land weights) are set to give sane relative behaviour (home-first while there is
cheap building; expansion as territory fills), then tuned in the single post-model calibration pass. The magic
numbers here are all *tunable inputs* with clear meanings, not structural — that is the point of the demand-ridden
spine.
