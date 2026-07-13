# Colonisation — Pool-Funded Expansion & Colony Bootstrapping

> **Detailed spec** for how a faction turns open frontier into productive worlds. Colonisation runs inside
> the directed-build processor's monthly pulse, ahead of the build step, and shares the faction construction
> pool with build-out. Sits *on* the autonomic build/pool machinery in
> [economy-autonomic-agency.md](./economy-autonomic-agency.md), the territorial `control` tiers in
> [faction-system.md](./faction-system.md#territorial-expansion-claim-and-develop), and the intra-faction
> migration topology in [trade-simulation.md](./trade-simulation.md). Processor order:
> [tick-engine.md](../engineering/tick-engine.md).

---

## Key mechanics (the headline)

A faction grows its territory in two ownership steps a month: **claim** stakes a cheap, near-instant border
(`unclaimed → controlled`), and **develop** settles a controlled system into a live colony
(`controlled → developed`). Developing is not free or instant — it is a **pool-funded, timed
colony-establish project** drawn from the same per-faction construction pool that builds housing and
industry. Expansion therefore **competes with build-out for one scarce resource**: a faction busy building
out its worlds cannot also keep grabbing new ones, so the planner self-limits without a hard cap.

The planner arbitrates expand-vs-build on **one ROI axis**. A colony's value is scored in the same
demand-rate units a build's served deficit is — the unmet demand its deposits unblock, plus the forward
**option value of the land itself**, gated so land value only outweighs marginal home building once existing
territory is filling up — minus the **opportunity cost of the population it seeds**. Funding orders every
proposal (builds and colony-establishes alike) by descending ROI and drains them front-first from the pool.

Every establish that completes lands a colony that is **viable by construction**: it flips `developed` with a
tiny conserved seed population *and* the housing to hold it, so a populated world with no room to live cannot
occur. From there the colony bootstraps from a two-person spark: **routed colonist delivery** water-fills
spare population from the faction's cores out to its emptiest frontier, **fullness-gated migration** lets an
empty colony draw settlers ahead of its jobs (their consumption then pulls the industry that staffs them),
and **housing leads population** so the colony's cap grows as it fills. The whole galaxy starts from these
cores: each faction capital is stamped with an identical **self-sufficient home-system prefab**, and every
other system begins an empty deposit field that expansion colonises into.

---

## Colony lifecycle

```
unclaimed ─(cheap, reach-bounded claim; per-pulse cap)→ controlled
controlled ─(planner scores it as a colony candidate: ROI(c) vs the faction's build ROIs)→
  if its ROI wins pool priority: a COLONY-ESTABLISH project is funded
    (work = base settle cost + the bundled seed housing's build cost)
  ─(funded from the shared pool over several pulses, value-ordered)→ project completes →
    system flips `developed`  +  conserved seed pop transferred  +  housing placed to hold the seed
  ─(now a normal developed system)→ colonist delivery + migration populate it;
    demand-driven build-out fills its deposits/industry as ordinary opportunities
```

Every arrow after `controlled` is paced by the same construction pool, so expansion and build-out share one
budget and one value ranking. **Claim** stays cheap and near-instant here — it is just drawing the border,
bounded by reach (`EXPANSION.REACH_JUMPS`) and a small per-pulse claim cap; controlled-but-undeveloped
systems may pile up as inert borders (population 0, no pool draw). **Develop** is the funded, timed project;
there is no per-pulse develop cap — the pool and the settler-supply gate pace it.

---

## Colony valuation — expand-vs-build on one ROI axis

A colony candidate is scored by `colonyValue` (`lib/engine/colonisation-value.ts`) on the same demand-rate
axis a build's served deficit uses, then netted against the population it spends and divided by its establish
work to give an ROI the funding stage ranks directly against builds:

```
value(c) = U(c) + L(c) · ( σ_floor + (1 − σ_floor) · σ )  −  popCost(c)
ROI(c)   = value(c) / establishWork(c)
```

A candidate whose net value is ≤ 0 — the labour it would drain outweighs the colony's worth — is dropped.

### U — unblocking value (demand-driven, coefficient-free)

Deposits are the economy's only hard scarcity: general space is fungible, but a **missing deposit** is
something a faction physically cannot build around. `U(c)` credits a colony for the unmet demand its deposits
unblock, traced **down each blocked good's recipe chain** to the deposit(s) that gate it — a deposit's worth
is mostly downstream (a lithium world matters for every good that needs lithium, not for raw lithium demand):

- `missingResources` is the set of resources the faction has **zero** deposit slots for across its developed
  systems — the binary "can't make it at all" line. A resource it holds *any* of (even maxed out) is not
  missing.
- For each good the faction under-produces, walk its **recipe closure** (`RESOURCE_CLOSURE`, precomputed once
  from `GOOD_RECIPES`: good → the tier-0 resources it transitively needs); the ones in `missingResources`
  gate it. The good's rate deficit is split **equally across its gating missing resources**, so a good needing
  two missing deposits contributes half its demand to each — a colony supplying one scores half, both scores
  the whole, with no double-count.
- `U(c)` is the sum of that attributed demand over the missing resources the candidate has a deposit slot for.

`U` is already in demand-rate units, so it compares directly to a build's served value with no scale
coefficient, and it is naturally zero except when the colony supplies a resource the faction cannot make at
all — the keystone-deposit case colonisation exists to grab early.

### L and σ — land option value and territory saturation

`L(c)` is the value of the land *itself* — new habitable land → future population → future labour → future
production and demand, compounding independently of any current deficit:

```
L(c) = LAND_PREMIUM · habitableSpace  +  LAND_GENERAL_WEIGHT · generalSpace  +  LAND_DEPOSIT_WEIGHT · depositRichness
```

How much of `L` is live is gated by **territory saturation** `σ ∈ [0,1]` — the fraction of the faction's
habitable land already committed to housing: `σ = clamp(Σ built-housing popCap ÷ Σ habitable-potential
popCap, 0, 1)` across its developed systems (a faction with no habitable potential reads as fully saturated).
Low σ means ample unbuilt land at home (fill it first); high σ means territory is built out (new land is the
only way to grow). The `σ_floor` term keeps a configurable share of the land value live *before* saturation —
the land-grab instinct — so the crossover *emerges* from the ROI comparison rather than a hard threshold:

- **Early, with home headroom:** the best home build serves a large deficit → high build ROI; σ is low, so
  the land premium is mostly dormant → the faction builds out home first and does not grab generic land it
  cannot yet use. The exception is a keystone-deposit world (`U > 0`), which is meant to be grabbed early.
- **Home saturating:** deficits shrink and remaining builds get marginal → build ROI falls, and σ → 1
  activates the land premium → colonisation overtakes marginal industry.

### popCost — the seed-population opportunity cost

Moving people to a colony drains labour from its source, reducing the source's own output and exports. The
valuation charges for that, but only for the part of the seed that must come from **staffed** workers — idle
spare labour is ≈ free, so founding naturally prefers a job-short source and a healthy core stops bleeding
population:

```
sourceSpare  = max(0, sourcePop − sourceLabourDemand)
employedSeed = max(0, seedPop − sourceSpare)
popCost(c)   = SEED_POP_COST_WEIGHT · employedSeed · (source total production / staffed heads)
```

The cost is netted onto the **benefit** side (a subtraction from `value`), not the `work` denominator, so it
is measured in the same output units as the benefit and needs no invented exchange rate. `establishWork(c) =
COLONY_ESTABLISH_WORK + housingLevels × housing level-work` — the base settle cost plus the build cost of the
housing the colony lands with, so the pool genuinely pays for the housing rather than getting it free.

---

## Value-ordered, pool-funded, timed establish

Because a build and a colonisation both draw the shared pool, funding orders **by ROI, not front-first FIFO**.
The unit that carries an ROI is the **proposal**: a `BuildProposal` bundles a production level-set with the
academies/complex that gate it (scored at the bundle's ROI so an enabler raises cost without inverting the
gate-first order), and a `ColonyProposal` is a single-item colony-establish carrying its `colonyValue` and
`establishWork`. Funding orders all proposals by descending ROI and drains them front-first from the
per-faction throughput pool (`fundQueue` stays the decision-free drainer; the ROI ordering is entirely a
reorder of its input). In-flight projects from prior pulses finish before equal-ROI newcomers, so started work
never starves.

There is **no per-pulse develop cap**: every eligible controlled candidate above the ROI floor is proposed,
and a proposal is persisted as an in-flight `colony_establish` project only once it **receives funding** — so
the top-ROI few advance while the rest are simply re-scored next pulse and the queue never balloons with
unfunded colonies. Work accrues over pulses; the system flips `developed` only when the project completes.
That spread over pulses **is** the establish time — the establish cost is paid in the currency of forgone
building. To run faster or slower, move the cost (`COLONY_ESTABLISH_WORK`) or the `σ_floor`/`LAND_PREMIUM`
knobs, never add a cap.

### The settler-supply founding gate

A second, population-side throttle keeps a faction from founding more colonies than it can actually populate.
Each pulse it computes its **releasable settler flow** — idle spare labour plus a small always-on staffed leak,
summed over its developed systems — and the number of **hungry** colonies still below their housing cap. New
foundings are capped to `floor(releasable ÷ MIN_SETTLER_SUPPLY) − hungryColonies` of the best-valued
candidates, so a faction fills the colonies it has before it sprawls into ones it can never fill. The gate
disables at `MIN_SETTLER_SUPPLY ≤ 0`.

---

## Viable by construction — seed pop + bundled housing

An establish completes into a viable colony in one atomic step (`applyDevelopments`, `lib/world/tick.ts`):

- **The seed population is land-sized and conserved.** `seedPop = min(COLONY_SEED_POP, whole-level habitable
  capacity)` — a land-poor system takes a proportionally smaller seed. It transfers from the nearest developed
  same-faction system, fixed at proposal time and capped at apply time by what that source can still spare, so
  it is subtracted from the source and added to the colony — never minted. A shared source's remaining
  spendable population is tracked across the pulse so two establishments can't both draw the same people.
- **Housing is bundled, sized to hold the seed.** `housingLevels = ceil(seedPop ÷ POP_CENTRE_DENSITY)`, bounded
  by the colony's habitable land, so `popCap ≥ seedPop` the instant the colony exists. There is no `popCap ≈ 0`
  stranded-population state. The bundled housing's build cost is rolled into the establish work total.

The seed is deliberately **tiny** (`COLONY_SEED_POP = 2`): a large seed drains the source and dumps population
on a jobless world faster than jobs can form. Instead the two-person spark staffs a first local basic, whose
jobs pull job-aware migration in, and the colony grows at its own pace.

### popCap tracks housing; proactive housing leads

Once developed, a colony's `popCap` **tracks its built housing**, not its seed level: whenever housing is
completed, `applyBuildingIncreases` raises `popCap` to the new housing's capacity (never lowering it — decay
owns downward moves). Without this a colony could build housing but never grow into it — `popCap` would weld to
the seed and pin population there forever.

Housing also **leads** population: the autonomic build planner's proactive-housing pass builds housing ahead of
population at *fed and calm* systems, paced to keep `popCap` a small margin ahead of current population and
rounded up to at least one whole level once occupancy catches the margin (so a one-level colony can ratchet up
instead of needing population to exceed its own cap). This creates the headroom migration and delivery then
fill. (Full autonomic-build detail: [economy-autonomic-agency.md](./economy-autonomic-agency.md).)

---

## Populating a colony — routed delivery + fullness-gated migration

Gradient diffusion migration is a local flow: it balances neighbours but mathematically cannot reach a colony
several hops from any population (people puddle near the cores). Two mechanisms fix that, both on the monthly
migration pulse:

- **Routed colonist delivery** (`lib/engine/colonist-delivery.ts`) is the primary colony population supply.
  Each pulse every sufficiently-populated developed system contributes a rate-capped slice of its **idle spare**
  (population above its own job needs — never its working population, so cores don't crater) into a faction
  pool, and the pool is **water-filled** across the faction's developed systems: it raises the *emptiest*
  colonies first toward a common level, capped by each one's housing headroom. Because it fills the lowest, not
  the nearest, the far frontier catches up instead of starving — the goal is a tight distribution (mean near
  max), not a power-law where near colonies hoard the flow. Conserved per faction; the source floors at its own
  labour demand, so it keeps its workers and its regrowth re-donates over time.

- **Fullness-gated migration** (`lib/engine/migration.ts`) adds a **jobs** term to migration attractiveness
  (open jobs pull, over-staffing pushes), but the unemployment *push* is scaled by how full a system's housing
  is. An under-occupied colony rides its housing headroom and **ignores its lack of jobs** — so a fresh,
  jobless colony still draws the settlers it needs, people settle available land ahead of industry, and their
  consumption then pulls the industry that staffs them. Open-jobs pull is unconditional; a *full*, job-short
  system still sheds its surplus. Without this asymmetry a jobless colony would score negative on jobs, cancel
  its headroom, and never bootstrap. Diffusion migration itself is tuned below the natural growth rate — pure
  local balancing on top of delivery, never a drain that outpaces regrowth.

Jobs shape **where** people go but do not hard-cap how many a colony absorbs — a hard open-jobs cap froze
bootstrap (a tiny colony's jobs are too few for population to ever exceed them and create demand). Housing
headroom stays the hard overshoot bound; the soft jobs term handles "don't overfill a jobless full colony".

---

## The starting condition — home-system prefab & tiny-seed colonies

The galaxy starts from faction cores and grows outward. World-gen (`stampHomeworldPrefabs`,
`lib/engine/universe-gen.ts`) stamps each faction capital with an identical, **self-sufficient home-system
prefab** (`lib/engine/homeworld-prefab.ts`) and leaves every other system an empty deposit field:

- **The prefab is a real tier-0 → tier-2 economy.** Whole-integer building counts are computed once from the
  economy constants so local production meets the capital's residents' full civilian consumption — the
  per-capita baseline plus the technician/engineer skilled-worker baskets — plus the recipe draw of its own
  factories, with academies to license the skilled work and housing to hold the population. It is the same for
  every faction and `ECONOMY_SCALE`-invariant (output and consumption carry the same scale factor, so the
  production ≥ consumption balance holds at any scale). The capital manufactures every tier-0/tier-1 good and
  the civilian tier-2 goods (electronics, machinery, luxuries); military tier-2 is deliberately imported (the
  war system's concern). It is not seeded by the fractional substrate allocator, whose scale-down and
  whole-level floor wiped small manufacturing counts and left the galaxy extraction-only.
- **A guaranteed garden body holds it.** The prefab is stamped onto one deterministic garden world sized a
  headroom margin above the prefab's exact footprint (habitable span, general space, and a spread of deposit
  slots), prepended to the homeworld's procedural bodies, so nothing is ever floored or scaled down.
- **Every other system starts bare** — population 0, no buildings, `unclaimed` — an empty deposit field
  expansion colonises into via claim → establish.

New colonies then **bootstrap from the two-person seed**: the tiny conserved spark staffs a first local basic,
colonist delivery and job-aware migration pull population in behind its jobs, proactive housing raises the cap
as it fills, and demand-driven build-out stands up its deposits and industry — the colony grows into a
productive system at its own pace rather than being seeded whole.

---

## Calibration

Colonisation is **coarsely calibrated** to give sane relative behaviour — home-first while there is cheap
building, expansion accelerating as habitable territory fills, colonies populating the frontier broadly rather
than dying empty. The valuation coefficients (`COLONISATION` in `lib/constants/colonisation.ts` —
`COLONY_ESTABLISH_WORK`, `LAND_PREMIUM`, `SIGMA_FLOOR`, the land weights, `SEED_POP_COST_WEIGHT`,
`MIN_SETTLER_SUPPLY`) and the delivery/migration knobs (`lib/constants/population.ts`) are tunable *inputs* with
clear meanings, not structural — a per-doctrine lookup can feed them later without changing any formula.
Further magnitude tuning is future work.

---

## Player-directed founding (deferred)

Colonies are founded by the faction planner's value-ordered proposals; the player has no surface to direct a
colony by hand yet. Player-initiated founding is designed to inject a colony-establish proposal into the same
build queue, funded from the same pool — keeping one mechanism for AI and player — see
[grand-strategy-vision.md](../../planned/grand-strategy-vision.md).
