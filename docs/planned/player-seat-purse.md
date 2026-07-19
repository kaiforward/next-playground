# The Purse — Faction Treasury (Player-Seat Slice 3)

> **Planned spec — design settled 2026-07-19, not yet built.** Supersedes the purse section of
> [player-seat-roadmap.md](./player-seat-roadmap.md). When the slice ships this moves to
> `docs/active/gameplay/` and the [Deferred by design](#deferred-by-design) section migrates to the
> roadmap doc.

## Headline

Every faction gets a treasury. It fills from two taxes on real economic activity — **employed heads
(grade-weighted)** and **production (at fixed reference values)** — scaled by a five-step **tax
level** whose cost is unrest. It drains through three **budget bands** (0–100% funding sliders):
**maintenance** (the standing sink, coupled to building decay), **logistics**, and **construction**.
Money is *fuel*, not capacity: the physical pools (eligible heads + Construction Centres, the
logistics work-budget) remain the ceilings, and a band's funding level sets what fraction of that
physical throughput actually runs. Wealth can never buy past the physical ceiling — only up to it.
When income falls short, a fixed priority ladder (maintenance → logistics → construction) stalls
growth before it rots stock; there is no debt. All nine factions run the identical mechanism.

Interactions: tax level feeds the per-system `unrest` integrator (over-taxation ultimately triggers
the existing catastrophic building-collapse channel); the maintenance band modulates the existing
idle-decay machinery; band funding gates the existing construction pool and logistics work-budget.
No new physical mechanics — money activates or starves the ones that exist.

## The treasury container

- One treasury per faction: a single balance, JSON-serializable, clamped at ≥ 0 (no debt
  instrument in v1).
- Income and expenses are **itemised line items** from day one (income: heads tax, production tax;
  expenses: maintenance by building type, logistics, construction). Itemisation is the extension
  mechanism: every later money mechanic (spot-price tax line, wages, claim costs) is a new line,
  never a redesign. Don't over-fit the container to construction.

## Income

### Line 1 — heads tax (Vic3 income-tax shape)

Grade-weighted employed heads per system (from `computeLabourAllocation`): linear per-head weights
by labour grade, meaningfully steep (spirit of 1 : 3 : 9 unskilled : technician : engineer; exact
ratios are harness calibration). Smooth and demographic; sags with genuine economic collapse
(staffing-gated employment). Revenue geography follows development — skilled core worlds out-earn
frontier headcount — so education/development interleave with fiscal capacity automatically.

### Line 2 — production tax (assessed-value shape)

Production in physical units × **fixed per-good reference values** (a cadastral tax: the assessor
values a tonne of alloys at its standing worth, not today's local spot price). Responsive and
industrial: an input-starved factory produces less and taxes less, so this line tracks what the
economy actually *does* — richer than heads alone. Production-only (no consumption line): today's
consumption is a deterministic function of headcount, so taxing it would double-count the heads tax.
It becomes a distinct instrument only at pop monetisation (Stage 3 below).

### Why reference values, not spot prices (design rule)

"Grounded in real activity" and "coupled to spot prices" are separable — the spot price is just one
valuation of activity, and it is the valuation that carries the risks:

1. **Shortage reads as prosperity** — scarcity spikes prices, so a starving faction's tax income
   *rises*; the state gets rich off a famine (sign-perverse; heads/units have the right sign).
2. **Undamped boom-bust loop** — prices → income → construction → supply → prices is a delayed
   feedback oscillator. Vic3 survives it because state construction *buys goods* (demand props
   prices — a damper); our construction spend is pure activation, so we'd ship the amplifier
   without the damper.
3. **Maturity drift** — price spread plausibly flattens as the galaxy matures, silently deflating
   state income on an axis nobody controls.
4. **Imputed revenue mismeasures trade** — we model no transactions; production × *local* spot
   price under-reports exporters (home price crushed by own supply) and over-reports local
   scarcity, punishing exactly the specialised economies the three-pillar design rewards.
5. **Perverse incentive** — price-linked income makes engineered scarcity fiscally optimal.
6. **Calibration coupling** — every pricing retune would silently re-tune all nine treasuries.

**Rule: price-linked income ships only after price-linked spending** (the damper before the
amplifier) — see Stage 2 below. Circularity itself is *not* the problem (prices → revenue → tax is
one-directional within a tick); the problems are dynamic.

## Tax level (the policy lever)

Five discrete steps (very low → very high), per-faction. Steps, not a slider: bands are
*allocation* (continuous by nature); the tax level is a *policy stance* — a legible discrete
trade-off. The level applies a rate multiplier to both income lines and feeds a proportional
pressure term into the per-system `unrest` integrator. Over-taxation therefore has a physical cost
path we already model: sustained unrest above the threshold is the catastrophic building-collapse
channel. AI factions get doctrine-flavoured default levels (each government flavour picks its
characteristic step).

## Budget bands (spending)

Three bands, each an EU5-style 0–100% funding slider against that band's *bill*. Bills are
wage-shaped and reference-valued: the cost of paying the people/capacity engaged at full
throughput (a starved band idles workers who exist but aren't paid). Construction's bill scales
with the physical pool (engaged construction heads + Construction Centres); logistics' with the
work-budget; maintenance's with the built stock. Exact rates are harness calibration.

- **Construction** — the bill is the activation cost of the physical construction pool; funded
  fraction scales how much of the pool's throughput runs. The `work ÷ absorbed` floor stands;
  backlog-frontier pricing and emergent build duration are untouched.
- **Logistics** — same shape against the logistics work-budget. The funding slider is itself the
  first logistics player verb (how much of the work-budget runs), distinct from the route-directing
  verb deliberately not built yet. Defaults to 100% so a fresh galaxy behaves like today unless
  someone deliberately starves shipping. (Future: logistics gets its own point-generating buildings
  — the Construction Centre parallel — making the two bands structurally symmetric.)
- **Maintenance** — the standing sink; see next section.

## Maintenance (the standing sink)

Every building level carries a reference-valued, type-weighted maintenance cost; the faction-wide
bill is itemised per building type in the UI. One **global** slider in v1 — Paradox precedent keeps
maintenance sliders coarse, and per-group triage sliders are a purely additive later split if
playtesting wants them (the itemised bill is already the structure).

**Design rule: the top of the slider may only charge flow; only the bottom may touch stock.**
Stock destruction (lost building levels) compounds into a death spiral; flow costs are recoverable,
which is what makes the slider a *usable* budget lever rather than a self-harm dial.

- **Upper zone (100% → ~50%)** — recoverable output malus scaling with the shortfall (order of
  −2–3% output at 90% funding). No decay. This is the deliberate budget-crunch lever: run lean,
  produce less, recover fully.
- **Lower zone (< ~50%)** — scales the existing idle-decay aggression (the idle-buffer length).
  Fully funded is *gentler than today's decay* (a deliberate rebase — base decay is currently a bit
  harsh); deep underfunding shortens the buffer below today's and, near 0%, wears down even
  staffed buildings (slightly stronger than today's worst case). Today's constants sit near the
  mid-scale point.
- **Implementation trap (load-bearing):** the upper-zone malus must NOT feed the idle-detection
  signal. Decay's idle check runs off `buildingUsed` utilization — the malus must scale output
  *after* utilization is measured, or the soft zone silently becomes the destructive zone.

## Deficit behaviour

No debt in v1. When the treasury can't cover the bands at their slider settings, the shortfall
follows a **fixed priority ladder: maintenance → logistics → construction** (paid in that order;
construction is shorted first). The flow-vs-stock rule decides the order — construction stalling is
fully recoverable (the queue waits), unpaid maintenance compounds. The ladder is fixed, not
player-orderable: sliders give priority control in normal times; the ladder is only the emergency
order, and it gives AI factions sane crisis behaviour for free. The paid fraction *is* the
effective funding level, so bankruptcy reaches the maintenance decay zone only after construction
and logistics have already stalled — the destructive regime is reached through real insolvency,
never by nudging a slider.

## AI parity

Same-brain: all nine factions run the identical treasury. v1 defaults: all three bands at 100%;
tax level doctrine-flavoured. No hand-authored budget personalities — the priority ladder under
income pressure produces more honest differentiation than authored allocations would. The player
seat starts from the same defaults, so a new game behaves like today's galaxy until the player
touches something.

## Harness metrics (the coarse health bar for money)

The treasury is faction machinery, not player machinery — it runs identically in the calibration
harness. Per-faction, over a run:

- **Balance trajectory** — no runaway hoards (a monotone hoard means the maintenance sink is
  undersized against income) and no designed-permanent insolvency; solvency dispersion across the
  nine factions.
- **Funded-fraction distribution per band** — how often construction actually starves (some
  scarcity is desired; permanently pinned at 0 is a fault), whether logistics funding ever
  throttles transfers (the colonisation lifeline).
- **Income composition** — heads vs production shares, per system and per faction (which systems
  carry the treasury — the observable the design wants to surface).
- **Standing guards** — no NaN, no negative balances, clamp at zero, JSON-safe.

## UI surfaces

- **Faction panel — treasury card**: balance, itemised income (heads line, production line),
  itemised expenses (maintenance bill by building type, logistics, construction), the three band
  sliders, the tax-level control.
- **Construction command card**: a funded-fraction readout, so the pool's activation state is
  visible where builds are queued.
- Per house rule, the treasury card gets its collaborative HTML design pass before implementation —
  this spec fixes *what* it shows, not how it looks.

## Deferred by design

> On promotion of this spec to `docs/active/`, this section migrates to
> [player-seat-roadmap.md](./player-seat-roadmap.md). Each item carries its resume-context — do not
> reduce to one-liners.

### Monetisation staging (the arc this slice starts)

Each stage replaces a proxy with the real flow it stood in for; the itemised treasury structure
never changes.

- **Stage 2 — state spending becomes goods demand.** Construction consumes real materials bought
  at market prices (EU5 shape: goods drawn during construction, shortages pause builds). This is
  the damper that makes price-linked income safe. *Only then* add a spot-price-linked income line,
  kept a minority share next to the stable core (a minority share can't fund famine-states or make
  scarcity-engineering worthwhile, and the stable core damps the oscillator). Open design question
  from risk 4: value output at something less local than home-system spot price.
- **Stage 3 — pop monetisation.** Buildings pay wages; pops buy consumption at market prices. The
  heads tax retires into an income tax on real wages; the production-at-reference tax into a
  profits/dividends tax; and a **consumption tax** (VAT on real transactions — bites poorest pops
  hardest, the sharpest revenue↔unrest instrument) becomes available as a genuinely distinct third
  line. "Which systems are rich" becomes fully emergent rather than assessed.

### Control (future system, not just a tax modifier)

Control is *the* space-native version of EU5's multiplier: real distances make control expensive in
a way map adjacency never is. First fiscal form: **unrest-attenuated collection** (high taxes →
unrest → lower collection — a self-damping stabiliser using existing machinery). Later:
capital/distance-based control, development as an input.

### Claim pricing (designed alongside control)

Claims (the cheap `unclaimed → controlled` border-staking step; develop already carries the
physical colonisation costs) should cost money — but the interesting price is control-shaped
(further from the core → dearer to claim and to keep), so it waits for the control design rather
than shipping as a flat fee. The per-pulse claim cap + reach bound prevent degenerate free grabbing
in the meantime.

### Per-building-group maintenance sliders

If playtesting shows genuine want for triage ("protect industry upkeep, let housing slip"), split
the one maintenance band into a few grouped bands — purely additive on the itemised bill. Costs
are UI surface, AI policy per slider, and calibration axes — pay them only once the choice is
proven fun.

## Research appendix (Vic3 / EU5, 2026-07-19)

- **Vic3 construction**: capacity is physical (sector buildings → weekly construction points);
  money is the fuel (wages + input goods weekly; goods bill scales with capacity used). Private
  queue halts when its pool is dry. Bankruptcy: −75% construction efficiency.
- **Vic3 income**: poll taxes + percentage taxes (income/consumption/dividend). The 5-step tax
  level trades revenue against radicalism/legitimacy. Collection is lossy under weak bureaucracy —
  the state absorbs the waste, pops pay full nominal. Vic3 taxes **only pops** — possible because
  pop income is a modelled flow (our heads-by-grade is the wage proxy until Stage 3).
- **EU5 income**: per-location tax base = RGO + building profits + burgher trade, × **control**
  (capital proximity, satisfaction, integration). Minting converts tax base to gold with an
  inflation threshold. Expected-expenses categories are the smooth 0–100% investment-dial pattern
  this design's bands copy.
- **EU5 construction**: upfront gold cost scaled by local construction-goods prices; goods consumed
  *during* construction, shortages pause it; ~20%-of-income standing maintenance sink; bankruptcy
  −90% construction speed, building downgrades.
- Sources: vic3.paradoxwikis.com (Construction, Taxes, Building) · eu5.paradoxwikis.com (Economy,
  Building) · pcgamesn.com/victoria-3/construction-buildings
