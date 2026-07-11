# Economy — Colony Bootstrapping & the ROI Decision Framework

> **Status:** Planned (not built). Design north-star for the economy work that follows the colonisation-cost
> arc (PR1–PR3 shipped) and the build-queue UI PR. Supersedes the original "PR4 = simulator metric +
> calibration" scope — calibration cannot precede the model changes below. Cross-refs:
> [`economy-colonisation-cost.md`](./economy-colonisation-cost.md) (the pool-funded establish mechanic this
> builds on) and [`economy-demand-driven-model.md`](./economy-demand-driven-model.md) (the three pillars).

## Headline

Colonies get founded correctly (the pool-funded, value-ordered establish mechanic works) but then **fail to
develop into productive systems**: they import nearly everything from the homeworld, build almost no local
industry, and their seed population withers for lack of jobs. The root causes are three mispricings in the
**same decision layer**, not a bug in colonisation itself:

1. **The build planner over-cancels colony deficits.** A good is only a build target if *no reachable
   exporter exists* — an **existence** test, ignoring whether that exporter's surplus *flow* actually covers
   the colony's demand. One spare unit at the homeworld cancels a fifty-unit colony deficit, so the colony
   builds nothing and imports an amount logistics may never deliver.
2. **The colony decision is blind to the population it spends.** `colonyValue` prices a colony's worth and
   its *construction* cost, but never the **opportunity cost of the seed population** — draining productive
   homeworld labour to seed a colony that cannot yet employ it. This is why homeworlds empty out quickly
   into colonies that don't develop.
3. **The shared construction pool is monopolised.** Even when a colony *has* a valid build, its low-ROI
   proposal loses the front-first pool to the homeworld's larger builds, so it never funds.

The fix keeps **ROI as the arbitration frame** — it is the right model, it is just **pricing the cost sheet
with half the entries missing**. Add the missing costs (flow-aware imports, seed-pop opportunity cost),
add a bounded **speculative self-supply** impulse so a colony proactively stands up its own tier-0 base,
and give the pool a **fairness floor** so colonies can actually fund what they propose.

## §1 Evidence (from the diagnostic sim, 120 systems, seed 11, ~1000 ticks)

- Mean **homeworld** industry: **14.8 levels**; mean **colony** industry: **1.1 levels**. Most of 34
  developed colonies have **zero** non-housing buildings.
- For zero-industry colonies, **26 of 26 demanded goods have no local production** — total import
  dependence.
- The **decay bounce** is real: a tracked colony's tier-0 count moved `2 → 1 → 2` (built, went idle,
  decayed, rebuilt) while its population plateaued at ~107.
- `popCap` sits far above `pop` on colonies (e.g. pop 53 / cap 320) — housing built ahead, but population
  never fills it because there are no local jobs. The **bootstrapping deadlock**: no industry → no jobs →
  idle colonists wither → can't staff industry → what little is built decays.

## §2 Design principles

- **Keep ROI; fix its price.** The one-queue, value-ordered arbitration (housing-leads, then descending
  ROI, deterministic) that PR2/PR3 built is the substrate. Do **not** replace it with bespoke colony logic —
  that would discard a clean, testable, extensible mechanism. Instead make the ROI *complete*: every scarce
  input a decision spends must appear in the cost, and every proposal kind's value must sit on a comparable
  axis.
- **Specialisation for the mature, bootstrapping for the young — via the same mechanism.** Autarky (every
  system builds everything) is wrong; total import-dependence for newborn colonies is also wrong. The knob
  is *degree*, gated on how developed/saturated the system is.
- **A smart faction is speculative, not greedy.** It invests some capacity in a colony's future
  self-sufficiency rather than front-loading whichever single system has the highest instantaneous ROI.

## §3 The four changes

### §3.1 Flow-aware deficit cancellation (fixes "imports cancel the build")

Today `findStructuralDeficits` cancels a deficit if **any** reachable system produces a surplus of the good
(`production > demand`, any magnitude). Change the cancellation to be **flow-aware**: a colony's rate
deficit is cancelled only to the extent reachable exporters' **spare surplus actually covers it**, netted
against the other consumers already drawing on that surplus. The **residual uncovered demand is
structural** → buildable locally.

- Effect: a colony whose demand exceeds the homeworld's spare export flow builds the remainder itself; a
  colony genuinely covered by ample nearby surplus still specialises (imports).
- Open: how to net surplus across competing consumers cheaply enough for the per-pulse planner (perf). A
  first cut may approximate with the exporter's total surplus vs the sum of reachable deficits.

### §3.2 Speculative local self-supply bias (makes colonies proactively develop)

Beyond the reactive fix, give an **undeveloped** system a bounded impulse to build a floor of its own
**tier-0 extraction from local deposits**, because self-sufficiency carries forward option value
independent of current import availability. Bounded (a floor, not autarky) so specialisation survives, and
**scaled by how undeveloped the system is** (strong when young, fading as the colony matures) — the natural
partner of the σ-saturation term already in `colonyValue`.

### §3.3 Seed-population opportunity cost (the highest-leverage change)

The colony decision must **charge for the population it moves**. Population is a scarcer early-game currency
than construction points, and the current model spends it for free:

- **Net the seed-pop opportunity cost into the colony ROI.** Draining productive homeworld labour reduces
  the homeworld's own output and exports (which the colonies then depend on) — a real cost the numerator
  must feel.
- **Size the seed to what the source can spare *and* the colony can employ/house** — not a flat 50. Dumping
  a full housing-block of population into a jobless colony creates idle colonists who decline. A smaller
  seed that grows via migration as local industry comes online is healthier.

This is what stops "homeworlds empty out quickly into colonies that don't develop."

### §3.4 Pool fairness (D)

The per-faction throughput pool drains **front-first by ROI**, so the homeworld's larger builds monopolise
it. Add a **fairness floor** — a per-system/per-colony minimum share, or a cap on any single system's draw
per pulse — so a colony with valid proposals gets *some* construction points. Only bites after §3.1/§3.2
give colonies proposals; sequence it last.

## §4 The ROI / Proposal framework as faction "brain" (extensibility target)

The `Proposal` union + `orderProposals` + `fundQueue` is becoming the **general decision substrate for the
faction AI**, not just auto-build. It will host many building mechanics and, later, **military** (fleets,
defences) as proposals with their own value/work. This section is the **rubric for the PR3 review's ROI
audit** — the framework must satisfy these to extend cleanly:

- **Comparable value axis.** Every proposal kind's `value` must live on one comparable scale (today:
  served demand-rate). Adding a kind must not require re-scaling the others. Military value in particular
  will need a demand-rate-equivalent or an explicit conversion — flag where that seam lives.
- **Complete cost.** `work` (the ROI denominator) must capture **every scarce input** a decision spends —
  construction points today, population (§3.3) next, money/treasury later. If a cost is invisible, the ROI
  lies (exactly the colony bug). Prefer a cost model that can carry multiple scarce currencies.
- **Open discriminant.** New `kind`s must be addable without touching the funding core (`fundQueue` stays
  decision-free; `orderProposals` narrows by kind only for tie-breaks/housing-lead). Audit that adding a
  proposal kind is additive, not invasive.
- **Customisable per faction/doctrine.** Coefficients (land weights, σ-floor, establish work, and the new
  pop-cost weight) are per-doctrine inputs; the formulae stay fixed. Confirm the parameter plumbing keeps
  that separation.

If the audit finds the current abstraction leaky against these, the refactor lands **on the PR3 branch as
review feedback** before merge — this is the moment to get the shape right, before many mechanics depend on
it.

## §5 Sequencing

1. **Build-queue / colony UI PR (next).** Ships the existing build-queue view (which works well) plus colony
   visibility, so pop drain, imports, and decay are observable while we tune. Unchanged priority.
2. **This redesign (after the UI).** Model changes §3.1–§3.4, *then* calibration. Calibrating blind — before
   the model changes and without the UI — would be painful and is explicitly out of order.

## §6 Testing strategy

- **Sim (outcome, via the real tick):** colonies reach a target industry-level floor; homeworld population
  is not over-drained; faction **total productive** population grows rather than being shuffled into idle
  colonies; decay bounce disappears.
- **Unit:** flow-aware cancellation leaves a residual structural deficit when exporter surplus is partial
  (§3.1); the seed-pop cost changes colony-vs-build ordering under a scarce pool (§3.3); the pool-fairness
  floor guarantees a colony ≥ its minimum share (§3.4); seed sizing tracks spare/employable population.

## §7 Open decisions (to resolve before implementation)

- Pricing the seed-pop opportunity cost: a standalone coefficient, or derived from the labour/throughput
  value the source loses?
- Flow-aware cancellation: the cheap-enough netting approximation, and its perf budget in the per-pulse
  planner.
- Speculative bias: floor size and how it decays as the colony matures (tie to σ, or a separate maturity
  term?).
- Pool fairness: minimum-share vs per-system draw cap.
- **Military & the shared queue:** does military genuinely share the *same* pool/queue as construction, or a
  parallel one that arbitrates at a higher level? This is the biggest extensibility fork and shapes §4.
