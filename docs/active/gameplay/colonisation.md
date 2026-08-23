# Colonisation — Priced Expansion & Colony Bootstrapping

> **Detailed spec** for how a faction turns open frontier into productive worlds, and what that costs it.
> Colonisation runs inside the directed-build processor's cycle start, ahead of the build step, and shares
> the faction construction pool with build-out and the faction treasury with every other bill. Sits *on*
> the autonomic build/pool machinery in
> [economy-autonomic-agency.md](./economy-autonomic-agency.md), the treasury in
> [player-seat-purse.md](./player-seat-purse.md), the territorial `control` tiers in
> [faction-system.md](./faction-system.md#territorial-expansion-claim-and-develop), and the intra-faction
> migration topology in [trade-simulation.md](./trade-simulation.md). Processor order:
> [tick-engine.md](../engineering/tick-engine.md).

---

## Key mechanics (the headline)

A faction grows its territory in two ownership steps a cycle: **claim** stakes a cheap, near-instant border
(`unclaimed → controlled`), and **develop** settles a controlled system into a live colony
(`controlled → developed`). Developing is neither free nor instant. It is a **priced, pool-funded, timed
colony-establish project** that costs three things at once:

- a **charter fee** — money, once, when the faction commits to the colony, scaled to the size of the
  faction doing the committing;
- **materials** — the colony's founding manifest, staged out of its founder's warehouses cycle by cycle
  and **paid for** at reference prices as it stages;
- **establish work** — construction points from the same per-faction pool that builds housing and industry,
  billed generically through the construction band like any other build.

So expansion competes with build-out for one scarce pool *and* with maintenance, logistics and construction
for one treasury. **Pacing emerges from those costs competing — nothing authors a founding rate.** A rich
faction sequences colonies against its other spending; a poor one stops expanding on its own, and a founding
already in progress slows or pauses when the money or the materials run short, then resumes.

The planner arbitrates expand-vs-build on **one ROI axis**. A colony's value is scored in the same
demand-rate units a build's served deficit is — the unmet demand its deposits unblock, plus the forward
**option value of the land itself**, gated so land value only outweighs marginal home building once existing
territory is filling up — minus the **opportunity cost of the population it seeds**. Money never enters that
value: affordability is a **gate**, evaluated per candidate against a running per-faction budget, so an
enabler raises the cost of a colony without changing what it is worth.

Every establish that completes lands a colony that is **viable by construction**: it flips `developed` with a
tiny conserved seed population, the housing to hold it, and whatever its staging ledger carries. From there
the colony bootstraps from a two-person spark: **routed colonist delivery** water-fills spare population from
the faction's cores out to its emptiest frontier, **fullness-gated migration** lets an empty colony draw
settlers ahead of its jobs (their consumption then pulls the industry that staffs them), and **housing leads
population** so the colony's cap grows as it fills. The whole galaxy starts from these cores: each faction
capital is stamped with an identical **self-sufficient home-system prefab**, and every other system begins an
empty deposit field that expansion colonises into.

A colony can also **end**. People do not move to famine worlds — a system in survival shortfall receives no
population inflow that cycle, by either path — and a famine world whose population collapses below one pop
(under a million people on a whole world) is **abandoned**: reset to unclaimed, factionless frontier,
claimable and colonisable again (see [Abandonment](#a-colony-is-allowed-to-die--abandonment)).

---

## Colony lifecycle

```
unclaimed ─(cheap, reach-bounded claim; per-cycle cap)→ controlled
controlled ─(planner scores it as a colony candidate: ROI(c) vs the faction's build ROIs,
              then the affordability gate against a running working balance)→
  if its ROI wins pool priority: a COLONY-ESTABLISH project enters the queue
    (work = base settle cost + the bundled seed housing's build cost)
  ─(the charter is paid in queue order; the project then absorbs work and stages
    manifest materials cycle by cycle, both bounded by what the treasury can buy)→
  project completes →
    system flips `developed`  +  conserved seed pop transferred  +  housing placed to hold the seed
                              +  the staged manifest delivered onto the colony's own market rows
  ─(now a normal developed system)→ colonist delivery + migration populate it;
    demand-driven build-out fills its deposits/industry as ordinary opportunities

developed ─(abandonment: famine AND population < ABANDON_POP_FLOOR, one pop)→ unclaimed again
    (population/buildings/popCap cleared; warehouses keep their stock; ordinary frontier)
```

**Claim** stays cheap and near-instant — it is just drawing the border, bounded by reach
(`EXPANSION.REACH_JUMPS`) and a small per-cycle claim cap; controlled-but-undeveloped systems may pile up as
inert borders (population 0, no pool draw, no charter). Claims are deliberately **not** priced: a claim is a
territorial intention, and the act worth pricing is committing to establish. **Develop** is the funded, timed,
priced project; there is no per-cycle develop cap — the pool, the treasury and the settler-supply gate pace it.

---

## What a colony costs

### The charter fee — money, once, at commitment

The charter is the felt decision moment, and by design the **dominant** monetary cost of a colony — roughly
3–5× the material bill at founding-era scales. It is quoted off the faction's own standing size rather than
off its current activity:

```
charter = max(CHARTER_FEE_MIN, CHARTER_FEE_SPEND_MULT × referenceMaintenanceBill)
```

Maintenance, not the total bill: maintenance is a standing-stock proxy for how much faction there is to
administer and does not move with the faction's own founding. The construction bill is largely the founding
burst itself, so a total-bill charter would self-reinforce during the burst and collapse afterwards — the
opposite of a knob that stays independent of the thing it prices. `CHARTER_FEE_MIN` is a real `max()` floor,
not a null-fallback: it binds at any horizon for any faction whose maintenance bill has collapsed, and it
covers the pre-first-settlement case.

The stored `maintenanceBill` is a per-settlement *flow* (`upkeep × catchUp`), but a charter is a one-off
charge on an event, so it is quoted against the bill **de-scaled to one reference cycle**
(`referenceMaintenanceBill`). Otherwise a settlement cadence twice as fast would halve what a colony costs,
which is granularity leaking into price. At the shipped cadence the divisor is 1.

**Committing and paying are one step.** Each cycle, every colony in the queue that has not yet paid tries to,
in queue order, against the faction's running working balance; the fee is re-quoted from the *current*
maintenance bill at the moment it is actually paid, not from the quote at proposal. A colony that cannot pay
stays unpaid and simply waits — it absorbs no work and stages nothing until the money is there. A colony that
*has* paid is a standing commitment: it is exempt from the persist-if-funded drop that would otherwise delete
a project the faction has already bought and re-emit it next cycle under a fresh id, charging a second charter.

### Materials — staged per cycle, paid at reference prices

The founding manifest is not a one-shot raid at completion. Each cycle, an in-flight establish stages a share
of the manifest matched to the construction work it is about to absorb: drawn from the founder's warehouses
under the same `surplusDrawable` export rule any logistics donor answers to, and **paid for** — the treasury
is debited the staged quantity's value, per good, as it stages.

The manifest is sized on the **colony's own basket**: `FOUNDING_STOCK_COVER` cycles of `consumptionRate` at
the seed population, per good the seed actually consumes. At a small seed that is mostly food and water and
only a trace of anything an engineer would want, with no per-good list deciding what matters. It is
deliberately *not* sized off the good's pricing anchor, which floors at `MIN_DEMAND` and at a 2-pop seed
flattens nearly every good to one figure, erasing the basket's shape.

**Materials gate work, not the other way round.** A cycle's work absorption is capped by the share of that
cycle's manifest slice the faction can actually stage and pay for, so ships, temporary surface infrastructure
and the seed housing are physically fed as they are built.

The staged goods are the colony's opening endowment. Because the draw is spread over many cycles against a
regrowing founder stock rather than taken in one bite, a colony is expected to open **closer** to the
`FOUNDING_STOCK_COVER` target than a single completion-time raid ever got it.

### Establish work — generic, unchanged

`establishWork(c) = COLONY_ESTABLISH_WORK + housingLevels × housing level-work` — the base settle cost plus
the build cost of the housing the colony lands with, so the pool genuinely pays for that housing rather than
getting it free. This work is billed generically through the construction band: the band's bill is one number
and a colony's work inside it is indistinguishable from a factory's, by design. The colony-specific money is
the charter and the materials.

### Both new debits are sinks, and both are founding-era

Charter and staging debits are true sinks — money leaves the world, there is no counterparty. Founding is a
startup burst, so the sink drains during the burst and stops. It does not address the equilibrium treasury
hoard and cannot: a one-time sink is a rounding error against an equilibrium balance. Recurring sinks are the
sibling cost mechanics' job (priced logistics, military, industry pricing).

---

## The decision side — the planner prices each candidate against a running balance

The affordability gate lives **inside** `planFactionColonyProposals`, per candidate, beside the existing
physical gates — it cannot run ahead of the planner, because the projected material bill needs the land-capped
`seedPop` and the source market set that only the planner knows. The faction's balance reaches it through
`ColonyEstablishParams`.

Gate-first, per the `Proposal`/ROI rubric (enablers raise cost or gate eligibility, never value): a candidate
is proposed only while the faction's **working balance** covers `charter + FOUNDING_GATE_HEADROOM ×
projected material bill`. The working balance is a real per-faction running budget down the value-ordered
candidate list: each accepted candidate decrements it by its own commitment cost, and the first candidate the
remainder cannot cover ends the list — it and everything below it drop that cycle and are re-scored next
cycle once the balance recovers. Without that running decrement a faction that can afford one colony commits
several and pays several charters; the goods side already solves the identical problem with its per-(source,
good) stock balance.

The projected bill is deliberately an **upper bound**: it values the *uncapped* manifest want, because what a
founder will actually be able to spare over the life of an establish is not knowable at proposal time.
Over-reserving is the safe direction. A candidate whose source sits outside the developed set contributes no
material projection — its market rows are not visible — leaving the charter as the whole quote.

The ROI value axis and the `work` denominator are untouched: money does not enter the value scalar, so there
is no invented money→output exchange rate. The existing physical gates — settler supply, habitable floor,
claim rate — all stand beneath this, and the money gate and the settler-supply gate are both prefix
truncations of the same value-ordered list, so their composition is order-independent.

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
L(c) = LAND_PREMIUM · peopleLand  +  LAND_GENERAL_WEIGHT · industryLand  +  LAND_DEPOSIT_WEIGHT · depositRichness
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
is measured in the same output units as the benefit and needs no invented exchange rate.

---

## Value-ordered, pool-funded, timed establish

Because a build and a colonisation both draw the shared pool, funding orders **by ROI, not front-first FIFO**.
The unit that carries an ROI is the **proposal**: a `BuildProposal` bundles a production level-set with the
academies/complex that gate it (scored at the bundle's ROI so an enabler raises cost without inverting the
gate-first order), and a `ColonyProposal` is a single-item colony-establish carrying its `colonyValue` and
`establishWork`. Funding orders all proposals by descending ROI and drains them front-first from the
per-faction throughput pool (`fundQueue` stays the decision-free drainer; the ROI ordering is entirely a
reorder of its input). In-flight projects from prior cycles finish before equal-ROI newcomers, so started work
never starves.

There is **no per-cycle develop cap**: every eligible, affordable controlled candidate above the ROI floor is
proposed, and an autonomic proposal is persisted as an in-flight `colony_establish` only once it has either
**received funding** or **paid its charter** — so the top few advance while the rest are simply re-scored next
cycle and the queue never balloons with unfunded colonies. Work accrues over cycles; the system flips
`developed` only when the project completes. That spread over cycles **is** the establish time. To run faster
or slower, move the cost (`COLONY_ESTABLISH_WORK`, the charter, the `σ_floor`/`LAND_PREMIUM` knobs), never add
a cap.

### The settler-supply founding gate

A second, population-side throttle keeps a faction from founding more colonies than it can actually populate.
Each cycle it computes its **releasable settler flow** — idle spare labour plus a small always-on staffed leak,
summed over its developed systems — and the number of **hungry** absorbers: developed systems still below
their housing cap, **plus every establish still in flight**, one each. Counting the in-flight ones is what
makes the gate's strength independent of how long an establish takes — a forming colony is `controlled` and so
invisible to the developed-systems loop, and a longer forming window would otherwise let a faction hold more
and more concurrent foundings against the same settler supply. New foundings are capped to
`floor(releasable ÷ MIN_SETTLER_SUPPLY) − hungry` of the best-valued candidates. The gate disables at
`MIN_SETTLER_SUPPLY ≤ 0`.

---

## Staging, cycle by cycle

The per-cycle order inside directed build is fixed, and the money phases run **before** the construction queue
is funded:

1. **Pay the charters.** Every unpaid colony in the queue tries, in queue order, against the running working
   balance (see above).
2. **Plan what is stageable.** For each in-flight establish with its charter paid, per good: the least of what
   is still wanted this cycle, what the source can spare (`surplusDrawable`, further bounded by the row's live
   stock and by a running per-(source, good) balance so two colonies drawing on one founder share a shrinking
   pile), and what the faction's remaining working balance buys through the valuation seam. Plans are drawn in
   queue order against the same balance the charters just spent from, so two colonies can never commit one
   faction's money twice.
3. **Convert the plan to a work ceiling.** The ordinary absorption cap is scaled by the value-weighted fraction
   of this cycle's manifest slice that is actually satisfiable. **A good the source cannot spare this cycle
   counts as satisfied** for that fraction — it does not hold the project back; the colony simply lands with
   less of it. Without that rule the ceiling would deadlock the median colony: a founder spares only part of
   the want, so the share could never reach 1 and the project would hold work below its cap for ever. What is
   left unsatisfied is therefore **money alone** — a faction that cannot pay stages less and builds slower.
4. **Fund the queue.** The ceilings reach `fundQueueWithFloor` through an optional `capFor?: (p) => number`
   callback (the existing scalar cap when omitted). The callback can only ever *lower* a project's cap: the
   scalar cap is the minimum-build-time floor, and a callback able to raise it would let a caller buy past
   that floor. The queue function takes one scalar cap for every project otherwise and has no market or
   treasury access — the callback is the seam that keeps it that way.
5. **Stage what was absorbed.** The work each project actually absorbed is recovered by diffing `workDone` by
   id, and the matching share of the plan is staged, debited from the founder's market rows, and charged to
   the treasury. Nothing is staged for work the pool did not fund. The proration divides by
   `min(ceiling, plannedWork)` — the work the plan could actually have funded — because the plan's lines were
   already cut to what the money bought; dividing by the un-ceilinged planned work would apply that
   affordability fraction a second time and stage (and charge) its square.

A faction with **no purse at all** — the build-only engine path, independents — founds exactly as it did
before: no charter, no materials, no staging. Pricing is a property of having a treasury.

### Staged goods are in-transit inventory

Between the draw and the delivery — the whole life of the establish — staged goods sit in the project ledger
and are in no market row at either end. They are invisible to pricing, to satisfaction, to logistics and to
decay for that window. This is the treatment freight in a hold would get: putting them in a market row at the
colony site instead would expose them to decay and to being drawn back out by logistics before the colony
exists to use them. Three readers treat the ledger as real inventory: cancellation, the save format, and the
harness's tonnage accounting.

`applyFoundingStagingDraws` moves every draw in **full or fails the tick**. A draw the source cannot cover is
not a cap doing its job — the plan is already bounded by that same live market row and by the running
per-(source, good) balance, so a short draw would mean the ledger had recorded goods that never left the
founder, and the completion delivery would mint them onto the colony. Clamping silently would make that a
world-state corruption no test could see; throwing makes it a hard pause with no broken world committed,
which is exactly what the store's tick atomicity is for.

Delivery at completion is therefore **credit-only**, and runs after the colony's market rows exist
(`addMarketsForSettledSystems`). Conservation is a property of the pair, not of either function alone: every
quantity credited at delivery was debited when it was staged. A conserving source→target move would
double-debit the founder and hand the colony only what the founder still happened to hold.

**If the source is lost** — the source system leaves the faction, or its market row for a good disappears —
that good is permanently unachievable and counts as satisfied from then on. The project runs on work alone for
the remainder and opens with whatever is already staged.

---

## Stall, resume, and completing on what is staged

A founding pauses or slows in any cycle where it cannot pay:

- **Unpaid charter.** A project whose charter the treasury cannot cover absorbs no work and stages nothing
  until the money is there.
- **No money for the next staging share.** The staging draw is scaled down to what the working balance covers,
  and the work ceiling scales with it; at zero it is a full pause. `balance` never goes negative — a purchase
  that cannot be paid does not happen.
- **The founder cannot spare the goods.** Handled by the achievable-want rule: a good the source cannot spare
  counts as satisfied, so this thins the endowment rather than gating the work.

A stalled project persists and resumes when conditions recover; nothing is refunded, nothing is destroyed.

**The stall counter advances on materials and money only.** `stalledCycles` increments on a cycle that stages
nothing *and* was not simply starved of construction pool: a ceiling above zero means the materials would have
let work through, so absorbing none of it is the queue's doing — colonies reserve no floor and can be
out-ROI'd indefinitely — and a project the pool never reached must not write off its manifest for a reason
that has nothing to do with what it can buy. Any staging draw resets the counter to zero.

**The escape.** A project that stages nothing for `FOUNDING_STALL_COMPLETE_CYCLES` consecutive cycles **writes
off its remaining manifest**: the unstaged remainder counts as satisfied from then on, the materials ceiling
stops binding, and the project finishes on construction work alone and opens with whatever is in its ledger.
The endowment shortfall is accepted — a colony that opens poor is a legible outcome; a colony that never opens
is not. It is never cancelled and no goods are conjured: the write-off removes a *want*, it does not deliver
anything unpaid. The counter runs only once the charter is paid, so a project that cannot afford its charter
can never escape into a free colony. A written-off project stages nothing thereafter, so its counter stays
latched above the threshold by construction — which is why the write-off needs no persisted flag of its own.

---

## Cancellation

`cancelOrder` deletes a player-originated project row outright, and work spent is lost by design, as is the
charter. The staged materials are not: they exist, they were paid for, and they came out of real market rows,
so **`stagedManifest` returns to the source's rows, uncapped** — stock coming home can never breach a reserve,
and there is no storage ceiling it did not already sit under before it left. Autonomic rows are never
cancelled. Total founder stock is unchanged across order → stage → cancel.

---

## The valuation seam

One function values goods for founding — the charter's material projection, the player verb's preview and the
staging debits all go through it:

```
value(goodId, quantity) = Σ (quantity / ECONOMY_SCALE) × GOODS[goodId].basePrice
```

The `/ ECONOMY_SCALE` is load-bearing, not cosmetic. Goods quantities ride S (`GOOD_CONSUMPTION` and friends
are `scaleRecord`s); money does not (treasury constants are S-invariant by construction). Every existing
quantity→money conversion normalises the same way — the production tax divides by S, logistics work is
S-normalised at accrual. The scale arrives as a **parameter** for the same reason it does there: the engine
graph never imports the env-resolved constant. Without the divisor the material bill at the live scale would
freeze founding galaxy-wide, while every unit test — pinned at S=1 — would read a plausible figure and see
nothing wrong, which is why S-invariance is checked explicitly rather than left to the suite.

The seam reads the catalog `basePrice`: a reference price, not a live local one. Live prices are the upgrade
this seam exists to make a one-function change. It deliberately does **not** read `REFERENCE_VALUE`: that
table is a cadastral *tax assessment*, value-added net of inputs, and as a procurement price it would put
alloys below the sum of their own inputs. Different authored meaning, wrong table.

---

## Where the money lands

Both debits are applied inside `runTreasuryProcessor`, which stays the **single writer** of `balance`.
Directed build accrues them into `pendingFounding` on `WorldFactionTreasury` on its own cycle; the treasury
processor drains and zeroes it at settlement — exactly the shape `pendingWork` already has, for exactly the
same reason. Directed build also reads it: its working balance for the gate, the charter and the staging plans
is `balance − pendingFounding`, which is what makes several commitments in one cycle sum correctly. Founding
debits arrive already valued in money, so they are never S-normalised again at settlement.

Three consequences are explicit rather than left to default:

- **The processor's guards know about it.** The treasury processor's early return and its mid-cycle branch
  both account for pending *founding* alongside pending work, and so does the tick body's own outer `hasWork`
  guard, which decides whether the treasury processor runs at all — it goes false on exactly the workless
  construction cycles an unpaid charter creates. Without all three, a founding debit accrued in a workless
  cycle is silently dropped.
- **Founding outranks the funding ladder, deliberately.** The debit passes `safeMoney` and lands **before**
  `settleLadder`, so founding money is taken off the top and the ladder — including the maintenance floor —
  divides what is left. The alternative (settling first, founding from the remainder) makes founding a
  residual claimant and the charter stops biting during exactly the burst it exists to pace. The cost is real,
  which is why the *distribution* of maintenance funding during the founding era is a calibration bar rather
  than an assumption.
- **The settlement clock is not the construction clock.** `CONSTRUCTION_INTERVAL` is independent of
  `CYCLE_LENGTH`; that they coincide today is a configuration accident. The charter's reference de-scaling and
  the staging share's `catchUp` scaling both exist so a cadence change moves neither price nor pace.

**The purse line.** `WorldTreasurySettlement` carries `foundingExpense` (charters + staging debits settled
that cycle) as its **own field** — never a fourth member of `TreasuryBands`, which is a three-field type
shared by the sliders, the bills and the latched `funded` fractions. Both readers honour it: the treasury card
renders a Founding `LedgerRow` alongside its three expense rows, and `services/treasury`'s
`net = income − (paid.maintenance + paid.logistics + paid.construction + foundingExpense)` subtracts it,
because a `net` that ignores a real expense is a correctness bug, not a presentation gap.

---

## Player-facing readouts

`ConstructionProjectColonyRow` carries `stalledReason` (`"awaiting_charter" | "awaiting_funds" |
"awaiting_materials" | null`, derived at read time — the world stores how long a project has been stalled,
never why) and `stagedFraction` (the value-weighted share of the manifest staged so far). Without these the
construction readout promises steady progress to a colony structurally unable to make any, with no way for the
player to see why or what would fix it.

The reasons bind in order, and they are **live tests against this cycle's share**, not a reading of the stored
counter:

- **`awaiting_charter`** — the charter is unpaid *and* the working balance cannot cover it. A freshly ordered
  colony whose faction has the money is not waiting on anything: the charter phase pays it in the cycle it is
  ordered.
- **`awaiting_funds`** — the treasury cannot pay for what the source could actually spare this cycle. This
  test runs whatever the stall counter says, because the work ceiling is priced from the same position
  unconditionally: a colony held at zero must carry its reason even at a counter of zero.
- **`awaiting_materials`** — the source has nothing to spare for this cycle's share. **This one is
  informational, not a stall.** The achievable-want rule counts what a founder cannot spare as satisfied, so
  the ceiling stays at the full cap: such a colony **builds at its normal rate** and simply opens with a
  thinner endowment. It is therefore the one reason that leaves `etaCycles` and `nextCycleGain` standing —
  a colony in `awaiting_materials` keeps a **finite ETA by design**, where the field's general contract reads
  `null` for a stall.

A project past the write-off threshold reads `null`: it has given up the rest of its manifest, so nothing
gates its work and it runs to completion on construction points alone. Its counter stays latched there by
construction, so without this it would report a permanent stall for the rest of a build that is actually
moving. Equally, a row that passes both live tests reads `null` whatever its counter says — the counter only
ever records that some *past* cycle bought nothing, and nothing but a staging draw retires it.

ETA and per-row rate come from the same ceilinged forecast the tick funds by: the readout rebuilds each
colony's ceiling and hands it to the forecast as a per-project cap, so a part-funded founding forecasts at its
reduced rate instead of reading as a standstill, and the projects *behind* it stop inheriting pool it was
never going to consume.

**The readout is deliberately optimistic where the tick is not.** Each colony's position is priced against the
whole of its source's headroom and the whole working balance, where the tick draws both down in queue order
across every colony founding that cycle. In particular, **each unpaid colony's readout deducts one charter
from the whole working balance independently, so two unpaid colonies against a one-charter balance both read
affordable** — it decides a displayed figure, never a debit.

---

## Viable by construction — seed pop + bundled housing + the staged manifest

An establish completes into a viable colony in one atomic step (`applyDevelopments`, `lib/world/tick.ts`):

- **The seed population is land-sized and conserved.** `seedPop = min(COLONY_SEED_POP, whole-level habitable
  capacity)` — a land-poor system takes a proportionally smaller seed. It transfers from the nearest developed
  same-faction system, fixed at proposal time and capped at apply time by what that source can still spare, so
  it is subtracted from the source and added to the colony — never minted. A shared source's remaining
  spendable population is tracked across the cycle so two establishments can't both draw the same people.
- **Housing is bundled, sized to hold the seed.** `housingLevels = ceil(seedPop ÷ POP_CENTRE_DENSITY)`, bounded
  by the colony's habitable land, so `popCap ≥ seedPop` the instant the colony exists. There is no `popCap ≈ 0`
  stranded-population state. The bundled housing's build cost is rolled into the establish work total.
- **The staged manifest lands as opening stores**, credited onto the colony's own market rows once they exist.
  A colony no longer opens holding nothing on every good and climbing out of a shortage it need never have
  been in.

The seed is deliberately **tiny** (`COLONY_SEED_POP = 2`): a large seed drains the source and dumps population
on a jobless world faster than jobs can form. Instead the two-person spark staffs a first local basic, whose
jobs pull job-aware migration in, and the colony grows at its own pace. Staging changes founding's cost, not
its size — the seed-vs-housing-unit question is a separate, deliberately separate, pacing change.

### popCap tracks housing; proactive housing leads

Once developed, a colony's `popCap` **tracks its built housing**, not its seed level: whenever housing is
completed, `applyBuildingIncreases` raises `popCap` to the new housing's capacity (never lowering it — decay
owns downward moves). Without this a colony could build housing but never grow into it — `popCap` would weld to
the seed and pin population there forever.

Housing also **leads** population: the autonomic build planner's proactive-housing pass builds housing ahead of
population wherever `fed()` passes (survival satisfaction only, no unrest input), paced to keep `popCap` a small margin ahead of current population and
rounded up to at least one whole level once occupancy catches the margin (so a one-level colony can ratchet up
instead of needing population to exceed its own cap). This creates the headroom migration and delivery then
fill. (Full autonomic-build detail: [economy-autonomic-agency.md](./economy-autonomic-agency.md).)

---

## Populating a colony — routed delivery + fullness-gated migration

Gradient diffusion migration is a local flow: it balances neighbours but mathematically cannot reach a colony
several hops from any population (people puddle near the cores). Two mechanisms fix that, both on the cycle
migration cycle:

- **Routed colonist delivery** (`lib/engine/colonist-delivery.ts`) is the primary colony population supply.
  Each cycle every sufficiently-populated developed system contributes a rate-capped slice of its **idle spare**
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

**The famine inflow gate.** People do not move to famine worlds. A system currently in survival shortfall
(a demanded survival good below the famine line — the same bit that bands it Famine) receives **no
population inflow that cycle, by either path**: colonist delivery skips it as a sink (its water-fill
headroom reads 0, index alignment untouched), and diffusion migration moves nothing toward it (its
destination headroom reads 0, whichever edge endpoint it is). Outflow is unaffected — a famine world still
donates idle spare above the source floor and its people still migrate away: exodus is wanted. The gate is
stateless: the famine set is derived each cycle from the economy's own supply fold and recovery re-opens
inflow the next cycle. Without the gate, delivery's emptiest-first fill systematically restocked famine
worlds with fresh colonists as their people died (measured: famine strikers pinned at exactly `popCap` with
a −0.00% trailing trend while their intrinsic decline was −0.75%/cycle), so a doomed world could never
actually decline. Both this gate and abandonment below are deliberately minimal scaffolding: the durable
design — one routed people-movement system for delivery and migration alike — is booked to the
logistics-pillar depth pass.

---

## A colony is allowed to die — abandonment

A famine world whose population has collapsed below **`ABANDON_POP_FLOOR` (1 pop — under a million people
on a whole world)** is over. The population processor reports it (famine AND post-delta population below
the floor, read from the same cycle's supply fold); the tick body — the sole owner of `control` writes —
applies the reset in one application:

- **System row:** population, unrest and collapse debt to 0; the stored Provision expectation deleted (a
  dead world's memory must not survive into a resettlement); `factionId → null`, `control → "unclaimed"`.
- **Buildings deleted, `popCap → 0`.** Infrastructure decay runs only on developed systems, so structures
  left standing would freeze forever and hand any resettler a free, fully-built colony.
- **Market rows survive with their stock** — a resettler inherits real warehouses — but the demand-derived
  fields reset (`demandRate` to the pricing floor; use-rate/squeeze/funding-bound state cleared) so a
  resettled colony is not priced and rationed as the dead world it replaced.
- **Open `build` projects targeting the system are dropped** — the former owner stops funding construction
  on a world it lost. (`colony_establish` projects cannot target a developed system, so they are out of
  scope by construction.)

The husk is ordinary claimable frontier again through the existing claim and colony-candidate paths — no
special resettlement machinery. The famine conjunct is the founding guard: colonies seed at 2 pops, so a
newborn only reaches the floor through ~90 consecutive cycles of unbroken famine with the inflow gate
refusing it settlers throughout — a genuinely dead colony, not an unlucky opening. The floor is a
**backstop, not a mercy kill**: decline is proportional to remaining population, so most declining worlds
rebalance small and live (shrinking demand raises satisfaction — a tiny, stable, fed outpost is legitimate
negative space, and a world that calms below one pop without famine simply persists). Constants:
`ABANDON_POP_FLOOR` in `lib/constants/population.ts`; transition applied by `applyAbandonments` /
`resetAbandonedMarkets` / `dropAbandonedBuildProjects` in `lib/world/tick.ts`.

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

Treasuries start at zero, so the first foundings wait on a faction's first settlements: the charter floor is
what a faction pays before it has any maintenance bill worth scaling against.

New colonies then **bootstrap from the two-person seed**: the tiny conserved spark staffs a first local basic,
colonist delivery and job-aware migration pull population in behind its jobs, proactive housing raises the cap
as it fills, and demand-driven build-out stands up its deposits and industry — the colony grows into a
productive system at its own pace rather than being seeded whole.

---

## Player-directed founding

Colonies are founded either by the faction planner's value-ordered proposals or, for the player's own
faction, a direct **establish colony** verb on a controlled system's Overview — one mechanism, two
originators. The verb shares the planner's own eligibility check and sizing function
(`colonyEligibility` / `sizeColonyEstablish`), so a player-ordered colony is identical in shape to an
autonomic one: same habitable floor, same reachable-seed-source requirement, same land-sized seed +
bundled housing, and **the same price**.

`colonyEligibility` evaluates an `insufficient_funds` block against exactly the planner's formula — the same
charter and projected-bill functions, against the same working balance (`balance − pendingFounding`) — and
returns the charter and the projected bill as displayed figures, so the UI shows the full price before
commitment. The material figure is labelled **"up to"**, because the projection is the uncapped want.

The block is a **hard** one, re-checked at the `orderColony` mutation boundary. With colonisation automation
off (the player's normal mode) the planner-side gate never runs for them, so without this the player faction
would be the one faction that founds for free, hold `already_forming` on the target indefinitely, and push the
maintenance floor around. Overspending is not a player freedom this design grants.

A player order enters the same `world.constructionProjects` queue with `origin: "player"`, funds from the same
per-faction pool, and — unlike an autonomic colony-establish — is never dropped for going unfunded a cycle (a
player order is a standing commitment until funded or cancelled; a charter-paid autonomic row is a standing
commitment for the same reason). Player rows also outrank new autonomic proposals in funding order. Full verb
+ UI detail: [player-seat.md](./player-seat.md).

---

## Persisted shape

`WorldColonyEstablishProject` carries `stagedManifest` (per-good quantities staged so far), `charterPaid` and
`stalledCycles`. `WorldFactionTreasury` carries `pendingFounding`; `WorldTreasurySettlement` carries
`foundingExpense`. All JSON-serialisable scalars and plain records; non-finite or non-positive quantities are
dropped at every write rather than trusted, because `JSON.stringify` turns a NaN into `null`.

All three project fields are **required, not optional** — that is what makes `tsc` enforce them at both
creation sites, the autonomic planner and the player verb, and there are exactly two. `deserialiseWorld` hard-
rejects any `formatVersion` mismatch and there is no field-defaulting path, so an old save fails loudly rather
than grandfathering in colonies committed under a free model.

---

## Calibration

Colonisation is **coarsely calibrated** to give sane relative behaviour — home-first while there is cheap
building, expansion accelerating as habitable territory fills, colonies populating the frontier broadly rather
than dying empty, founding pacing rather than freezing. The valuation coefficients and the cost constants
(`COLONISATION` in `lib/constants/colonisation.ts`) and the delivery/migration knobs
(`lib/constants/population.ts`) are tunable *inputs* with clear meanings, not structural — a per-doctrine
lookup can feed them later without changing any formula.

| Constant | Meaning | Value |
|---|---|---|
| `COLONY_ESTABLISH_WORK` | Base settle work, before the bundled seed housing's build cost | 60 |
| `LAND_PREMIUM` / `LAND_GENERAL_WEIGHT` / `LAND_DEPOSIT_WEIGHT` | Land option-value weights | 3.0 / 0.5 / 4.0 |
| `SIGMA_FLOOR` | Share of land value live before saturation — the expansionist dial | 0.25 |
| `SEED_POP_COST_WEIGHT` | Weight on the seed's forgone-output cost | 1.0 |
| `MIN_SETTLER_SUPPLY` | Releasable settler flow required per hungry absorber | 5 |
| `FOUNDING_STOCK_COVER` | Cycles of the seed's raw consumption the endowment aims at — now a staging target rather than a completion-time draw | 30 |
| `CHARTER_FEE_SPEND_MULT` | Multiplier on the reference maintenance bill setting the charter | 6.5 |
| `CHARTER_FEE_MIN` | Real `max()` floor under the charter | 100 |
| `FOUNDING_GATE_HEADROOM` | Multiplier on the projected material bill in the affordability gate | 2.0 |
| `FOUNDING_STALL_COMPLETE_CYCLES` | Consecutive staging-nothing cycles before a project writes off its remainder | 80 |

The four cost constants get one coarse pass and then stay coarse: precision tuning waits for the sibling cost
mechanics (priced logistics, military, industry pricing) to land on the same treasury, per the standing
calibration rule.

### Health bars

Read at both horizons, cohorted, from `npm run simulate`.

- **Founding still happens, and paces rather than freezes.** Colonies are founded, the galaxy saturates, and
  the founding curve is spread across the era rather than resolving as one undecided rush. Cadence is read
  alongside cycles-from-commitment-to-completion, because cadence alone cannot separate "the gate refused"
  from "the construction pool got smaller" — founding money taken before the ladder lowers
  `funded.construction`, which shrinks the pool, which slows every build.
- **The money bars are founding-era bars.** Cumulative founding spend as a share of founding-era faction
  income, and the shape of the balance trajectory across the era. The equilibrium hoard is explicitly **not**
  a bar.
- **Funding does not collapse, measured at the tail rather than the median.** The median funding fraction sits
  at 1.000 and would keep reading 1.000 while the shorted tail tripled, so the bars are the shorted
  faction-cycle share over the founding era, and the **distribution** of `funded.construction` — median, p10
  and minimum — over founding-era faction-cycles that were actually **billed** for construction. An unbilled
  cycle latches the slider rather than a paid fraction, so including it would report a faction with nothing to
  build as a faction starved of funding. The bar is **p10 ≥ 0.5**: a single-cycle minimum cannot tell an
  outlier from a routine drain, and the two want opposite responses. The startup tail before the first
  founding is excluded from both bars, and reported separately so its exclusion is visible.
- **Maintenance survives being outranked.** The distribution of `funded.maintenance` across founding-era
  faction-cycles, not its median: founding debits land before `settleLadder` by design, and this is the bar
  that says whether that choice starved the floor.
- **Colonies open well stocked.** The staging target is `FOUNDING_STOCK_COVER` and the draw is spread over
  many cycles against a regrowing founder stock, so a thin endowment is a bug rather than a tradeoff. The
  endowment-responsive reads are the opened-deprived count, the colony cohort's opening Provision
  (mean and p10), and its non-Supplied band share (Strained + Rationing + Deprived + Famine); strike% is read
  **split by pop cohort**, never galaxy-wide, because it varies by tens of times across cohorts and pricing
  changes exactly that mix by changing how many colonies exist and how well they open.
- **The founder's cost is the real calibration question.** Mean manifest tonnage per colony and the founder's
  `surplusDrawable`-suppressed cycle share, plus a founder-cohort production and disuse-decay read: a
  sustained multi-cycle draw across every founder market lifts `sellingFactor` and lowers disuse decay, and
  tonnage alone cannot say whether the founder was squeezed or merely richer.

**Conservation and accounting are pass/fail, not calibration.** Σ charters over a run equals the number of
colonies that ever paid one; Σ charters committed by one faction in one cycle never exceeds that faction's
opening balance; total founder stock is unchanged across order → stage → cancel; Σ (staging debits +
charters) equals Σ `foundingExpense` across settlements and `net` reconciles with the balance delta; total
founding expense per colony is identical at `ECONOMY_SCALE` 1 and 100; and the whole ledger is invariant to a
`CONSTRUCTION_INTERVAL ≠ CYCLE_LENGTH` cadence.

Stalls are attributed by cause — awaiting charter, awaiting funds, awaiting materials — with founder-event-
driven material stalls counted separately, because an anchor-shift event at a founder throttling
`surplusDrawable` across an establish's whole life is accepted flavour: pacing emerging from real costs rather
than an authored rate, and the achievable-want rule means such an event thins a colony rather than deadlocking
it. Concurrent in-flight establish count is reported so the settler gate's invariance to establish duration
stays visible.
