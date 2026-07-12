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

## §3 The changes

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

### §3.3 Seed-population opportunity cost + gradual, job-shortage-driven draw (the highest-leverage change)

The colony decision must **charge for the population it moves**, and it must move that population the way a
real migration works — as a rate-capped flow out of sources that can spare it, not a one-time block dumped
on a jobless world. Population is a scarcer early-game currency than construction points, and the current
model spends it for free *and* instantly:

- **Net the seed-pop opportunity cost into the colony ROI.** Draining productive homeworld labour reduces
  the homeworld's own output and exports (which the colonies then depend on) — a real cost the numerator
  must feel.
- **Draw the seed gradually over the build cycle, not all at once.** EU5 and Victoria 3 both migrate pop as
  a capped monthly/weekly flow; only Stellaris does a one-shot founding, and it does so by *spawning* free
  pops from no source at all — which is the exact mispricing this whole redesign fixes, so it is the
  anti-pattern here, not the template. The draw rate is capped by the source's spare pop, so we never invent
  a seed number: the source's job surplus sets the rate.
- **Make a job shortage the primary push signal.** A source with idle/underemployed pop feeds colonies
  readily; a fully-employed source resists the draw. This self-corrects "homeworlds empty out" — a healthy
  homeworld stops bleeding pop the moment its own jobs are full — and it gives the player's *"take a big hit
  of pop from somewhere with a job shortage"* affordance for free: the same mechanic with the cap
  temporarily lifted when idle-pop surplus is large (Victoria 3's "mass migration" burst is exactly this).
  The burst is a **player action** layered on the gradual **default**.
- **Gate the destination pull on local jobs/housing.** Pop only arrives-and-stays as the colony stands up
  jobs (all three games gate arrival this way). This couples the draw to §3.2's local-industry bias: we
  never deliver pop faster than jobs appear, so the "idle colonists wither" deadlock cannot form. Sizing the
  seed to what the colony can *employ/house* then falls out of this gate rather than needing a separate flat
  cap.

This is what stops "homeworlds empty out quickly into colonies that don't develop."

### §3.4 Pool fairness (D)

The per-faction throughput pool drains **front-first by ROI**, so the homeworld's larger builds monopolise
it. Add a **fairness floor** — a per-system/per-colony minimum share, or a cap on any single system's draw
per pulse — so a colony with valid proposals gets *some* construction points. Only bites after §3.1/§3.2
give colonies proposals; sequence it last.

### §3.5 Player-directed founding via the build queue

Today the faction AI value-orders colony-establish proposals automatically; the **player** has no surface to
direct a colony. Found colonies the way EU5 does — a deliberate, funded decision — by letting the player
**inject a colony-establish proposal into the existing build queue**, funded from the same construction pool
over the build cycle (the pool-funded establish mechanic already exists; this is the player-facing entry
point). This keeps **one mechanism** for AI and player — the `Proposal` substrate (§4) — rather than a
bespoke colony command, and matches the "choose a target, pay over the build cycle" model shared by EU5 and
Victoria 3.

- Open (§7): does a player-pinned colony proposal **jump** the value order, or **compete** on ROI with a
  manual priority bump? This is the same lever as pool fairness (§3.4) — a player pin is a fairness floor
  the player sets by hand.

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

1. **Build-queue / colony UI — shipped.** The build-queue view plus colony visibility are in, so pop drain,
   imports, and decay are observable while we tune.
2. **This redesign (now active).** Model changes §3.1–§3.5 per the §7 decisions, *then* calibration.
   Calibrating blind — before the model changes — is explicitly out of order.
3. **UI surfacing (development map mode with PR1; the rest end of the work stream).** The **"development" map
   mode** (colouring systems by the new development stat, §7.7b) ships **with PR1** — the stat's data exists
   there, and painting it across the galaxy is how we sanity-check the formula (homeworlds hot, frontier cold).
   Development is **dynamic** data (it changes as systems grow), so the mode rides a tick-invalidated read
   path, not the static atlas. The rest is sequenced last because it visualises data that only exists after
   later PRs: **recent migration statistics** (who moved where, and the push/pull that drove it), colony
   job/employment state, pool-floor allocations, and small map polish.

## §6 Testing strategy

- **Sim (outcome, via the real tick):** colonies reach a target industry-level floor; homeworld population
  is not over-drained; faction **total productive** population grows rather than being shuffled into idle
  colonies; decay bounce disappears.
- **Unit:** flow-aware cancellation leaves a residual structural deficit when exporter surplus is partial
  (§3.1); the seed-pop cost changes colony-vs-build ordering under a scarce pool (§3.3); the pool-fairness
  floor guarantees a colony ≥ its minimum share (§3.4); seed sizing tracks spare/employable population.

## §7 Decisions (resolved) — with the pool (#9) still in detailed design

Resolved in a design pass with the project owner. **Reality check that shaped these:** the code has **no
employment→population coupling today** — migration is pulled by empty housing + contentment (not jobs),
population growth is gated by housing headroom + goods-satisfaction + unrest (not jobs), and "employment"
(`computeLabourAllocation`) is a display-only label that "changes no economy behaviour." So anything below
that gates on *jobs* (esp. #5) is a genuinely **new** mechanic, not a tweak. Parentheticals carry the
technical anchor for implementation.

### How a colony gets populated

1. **Seed model: how does a new colony get its people?** → **Decided: option C, minimally seeded.** Move a
   *tiny* bootstrap (≈1–2 pops), drawn from the source's **unemployed** first so it costs almost nothing
   (~0.1–0.2 off any one industry on a large world), then let job-aware migration grow the colony. The
   fairness (#9) + flow-aware (#6) fixes are what *create the local jobs* that make the colony
   self-attractive, so we deliberately under-seed and let the loop pull people in.

2. **Pricing: what does taking people cost the decision?** → **Decided:** the value of the work those people
   were doing back home (the source's forgone output), not a flat number. Draining busy workers is
   expensive; idle ones ≈ free — which automatically biases colonies to pull from a job shortage.

3. **Where does that cost appear in the AI's ranking?** → **Decided: on the benefit side** (net it out of
   colony value), keeping "effort" as a single construction-points number for now. Reason: the cost is
   measured in *lost production*, the same unit as the benefit, so no invented exchange rate is needed.
   *Separately banked:* construction points will later be **legitimised as a real produced thing** (built by
   construction facilities + staff + money), not an abstract token — its own future piece, and it sharpens
   #9.

4. **How fast do people move — and can the player force a big move?** → **Decided:** default speed = the
   existing migration rate (`migrationFlow`); a player "speed dial" pulls harder and costs money / an
   abstract currency later. Still a rate-limited flow, never an instant jump.
   - **Target-side throttle (required fix).** Today the per-pulse flow scales with the *source's* population
     and is clipped only by the destination's *absolute* headroom (`min(outflow, source.pop, destHeadroom)`),
     so a large homeworld **floods a tiny colony** — at current params (`maxOutflowFraction 0.05`,
     contentment+headroom weights 1) a ~300-pop homeworld pushes ~12 pops/pulse into a 1–2 pop seed. Fix:
     throttle the flow by the **target's absorptive capacity** — the jobs/space it can actually use now — so
     a small colony fills at *its* pace, not the source's. Composes with the jobs pull (#5) and the small
     deliberate seed (#1) to give a smooth ramp instead of a roller-coaster.

5. **What makes people want to move to (and stay in) a colony?** → **Decided:** add **jobs** as an
   attractiveness pull (`migrationAttractiveness` has none today — which is why empty colonies wrongly look
   attractive), with room for more pulls later. Jobless colonists **drift back out** toward jobs rather than
   getting a new "starve and die" rule. This single edit is load-bearing — it fixes the bad "empty colony is
   attractive" incentive, delivers the job-shortage push, and paces arrivals to the build, all at once.

### Making colonies build their own industry

6. **When may a colony build its own industry instead of importing?** → **Decided:** imports only
   *supplement* — the colony builds the part of its need that reachable supply cannot actually cover (first
   cut: `coveredFraction = min(1, Σ exporter-spare / Σ reachable-deficit)`; build the uncovered remainder).
   Kept flexible so the AI can get cleverer later; mostly-importing stays a valid outcome when it genuinely
   is the right call.

7. **Should young colonies get a nudge to build basic local industry even when imports exist?** → **Decided:**
   yes — a per-colony maturity nudge toward local basics, especially **un-repurposable deposits** (a water
   deposit can only ever be water; importing a basic you're sitting on is pure waste). Requires the new
   development stat (7b). We *cannot* reuse σ "saturation" for this — σ is faction-wide, not per-colony.

7b. **Do we have a development stat?** → **No** — "developed" is only an ownership gate (`unclaimed →
    controlled → developed`), not a magnitude. → **Decided: introduce a per-system development measure**
    (EU5/Victoria-style); very-low-development systems emphasise local food/water. Reusable well beyond
    colonisation.

### Fairness & player control

8. **How does the player found a colony by hand?** → **Decided (EU5-style):** player picks go in the shared
   build queue and are guaranteed to fund, displacing the *marginal* (lowest-value) AI auto-pick; queue
   enough and the AI's picks are fully crowded out (the player's choice), and automation is a toggle. To
   reliably happen, a player pick funds ahead of the AI's low-value picks. Distinct from #9, which is
   AI-internal budget sharing.

9. **How is the pool shared between systems? — direction agreed, details open.** The pool stays
   **faction-wide for now**: a 1–2 pop colony generates almost no construction points, so a purely local
   pool would re-break bootstrapping — the homeworld must be able to invest in the frontier. The hogging fix
   is a **fairness floor = a guaranteed *minimum* slice for colonies with valid proposals — NOT a max-spend
   cap** (a cap throttles legitimate high-value homeworld builds and can waste budget). Reserve a small slice
   for colonies-with-proposals first, they spend it, then the homeworld drains the remainder by value as
   today; nothing reserved if no colony has a proposal. *Motivation:* every system — colonies included —
   already **contributes** to the pool (`factionThroughputPool = Σ pop·throughputPerPop`), yet front-first
   draining hands it all to the homeworld, so the floor is *redistributive* — giving colonies back access to
   a pool they help fill (a tiny colony contributes ~nothing, so some homeworld surplus must flow down to
   bootstrap; intended). **North-star (future):** a locality-weighted, logistics-style **edge-diffusion**
   pool — each system accesses roughly what its own population generates plus what neighbours can share,
   fading with distance, with an explicit, *costed* projection of capacity to distant colonies. pool + floor
   is a strict subset of this, so it generalises rather than being thrown away. *Flagged:* player
   **legibility** (which "local" pools am I drawing from?) — the same difficulty logistics has. **Floor size —
   decided:** the floor scales with the new development stat (§7.7b) — biggest for the youngest colony, fading
   to nothing as it matures (self-weaning training wheels; one tunable per-doctrine coefficient). So the
   development stat drives **both** the speculative local-industry nudge (§7.7) and this floor. Full
   contribution-accounting ("each system accesses what it generates + neighbour sharing") is the
   edge-diffusion generalisation, **deferred** — the development-scaled floor is its v1.

### Deferred

10. **Do military / ships / armies / special buildings share this queue later?** → **Decided: defer, keep it
    flexible.** They will use the build queue, so the *type* system (proposal kinds) and the *currency* system
    (costs) both stay open to new entries. Pricing the pop cost as "benefit" (#3) keeps the door open for
    real, produced construction capacity + new currencies later. Biggest extensibility fork; shapes §4.
