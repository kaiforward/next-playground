# The Purse — Faction Treasury (Player-Seat Slice 3)

> **Planned spec — design settled 2026-07-19, hardened by adversarial spec review same day.**
> Supersedes the purse section of [player-seat-roadmap.md](./player-seat-roadmap.md). When the
> slice ships this moves to `docs/active/gameplay/` and the
> [Deferred by design](#deferred-by-design) section migrates to the roadmap doc.

## Headline

Every faction gets a treasury — identically: player, AI, and the (legacy-flavour) major/minor
distinction never touches mechanics. It fills from two taxes on real economic activity —
**employed heads (grade-weighted)** and **realized production (at fixed reference values)** —
scaled by a five-step **tax level** whose cost is unrest. It drains through three **budget bands**
— a *budget band* is a spending category with a 0–100% funding slider (not a tax band):
**maintenance** (the standing sink, coupled to building decay), **logistics**, and
**construction**. Money is *fuel*, not capacity: the physical pools (eligible heads + Construction
Centres, the logistics work-budget) remain the ceilings, and a band's funding level sets what
fraction of that physical throughput actually runs. Wealth can never buy past the physical ceiling
— only up to it. The treasury settles **once per month** (collect, then pay in a fixed priority
ladder: maintenance → logistics → construction); when income falls short, growth stalls before
stock rots, and there is no debt.

Interactions: tax level feeds the per-system `unrest` integrator (with the shipped strike channel
already damping over-taxation before collapse); the maintenance band modulates the existing
idle-decay machinery; band funding gates the existing construction pool and logistics work-budget.
One real engine change is required — exporting realized production from the economy sim (see
Income Line 2) — everything else activates or starves mechanics that exist.

## The treasury container

- One treasury per faction: a single balance ≥ 0 (no debt instrument in v1), stored in new
  per-faction `World` rows (factions become tick-mutable state; today they are immutable through
  the tick). JSON-serializable throughout — guard the funded-fraction math against 0-bills (see
  Settlement).
- Income and expenses are **itemised line items** from day one (income: heads tax, production tax;
  expenses: maintenance by building type, logistics, construction), with the last settlement's
  itemised snapshot persisted so UI reads don't recompute transients. Itemisation is the extension
  mechanism: every later money mechanic (spot-price tax line, wages, claim costs) is a new line,
  never a redesign.
- **Money is ECONOMY_SCALE-invariant** (load-bearing rule). Goods magnitudes scale with S but
  heads, building counts, and bills do not — so the production tax normalises units by S at
  collection. All money constants (reference values, grade weights, bill rates) are S-invariant by
  definition. This keeps treasuries — and everything funded by them — bit-comparable across S=1
  (the test suite) and S=100 (the live game), preserving the dynamic-invariance bridge.

## Income

### Line 1 — heads tax (Vic3 income-tax shape)

Grade-weighted employed heads per system (from `computeLabourAllocation`): linear per-head weights
by labour grade, meaningfully steep (spirit of 1 : 3 : 9 unskilled : technician : engineer; exact
ratios are harness calibration). Smooth and demographic; sags with genuine economic collapse
(staffing-gated employment). Revenue geography follows development — skilled core worlds out-earn
frontier headcount — so education/development interleave with fiscal capacity automatically.

### Line 2 — production tax (assessed-value shape)

**Realized** production in physical units × **fixed per-good reference values** (a cadastral tax:
the assessor values a tonne of alloys at its standing worth, not today's local spot price).
Responsive and industrial: an input-starved factory produces less and taxes less, so this line
tracks what the economy actually *does* — richer than heads alone.

- **Required engine change (the slice's one real economy touch):** realized per-(system, good)
  output is currently a transient inside the economy sim and is never exported — the only exported
  production number is *capacity* (no input gate), which would not sag under starvation and would
  re-create the famine-windfall perversity this design exists to avoid. The economy sim must
  export realized output per (system, good) per pulse, and the treasury persists the last
  settlement's snapshot (the itemised UI line needs it between pulses anyway).
- **Reference-value calibration must be value-added-aware**: taxing every good at full reference
  value at every chain stage is a turnover tax (ore taxed as ore, again inside alloys, again in
  machinery) that would over-reward deep local chains. Calibrate downstream reference values as
  value-added over inputs, or deep industrial cores out-earn twice.
- Production-only (no consumption line): today's consumption is a deterministic function of
  headcount, so taxing it would double-count the heads tax. It becomes a distinct instrument only
  at pop monetisation (Stage 3 below).

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
6. **Calibration coupling** — every pricing retune would silently re-tune every treasury.

**Rule: price-linked income ships only after price-linked spending** (the damper before the
amplifier) — see Stage 2 below. Circularity itself is *not* the problem (prices → revenue → tax is
one-directional within a tick); the problems are dynamic.

## Tax level (the policy lever)

Five discrete steps (very low → very high), per-faction. Steps, not a slider: bands are
*allocation* (continuous by nature); the tax level is a *policy stance* — a legible discrete
trade-off. The level applies a rate multiplier to both income lines and feeds a proportional
pressure term into the per-system `unrest` integrator. Over-taxation self-limits in layers we
already ship: the **strike channel** suppresses production above unrest ≈ 0.65 — cutting the
production-tax line well before the catastrophic building-collapse channel at ≈ 0.75 — a built-in
Laffer curve using existing machinery. AI factions get **government**-flavoured default levels
(tax stance is internal policy — the government axis, not doctrine, which is foreign policy).

## Budget bands (spending)

Three bands, each an EU5-style 0–100% funding slider against that band's *bill* — the monthly
price tag of running that band's activity at 100%. **Bills charge work performed, not standing
capacity**: construction's bill scales with the pool actually absorbed by the build queue (an
empty queue costs nothing that month — the pool primitive is essentially the whole non-skilled
population, so billing standing capacity would charge near-population wages for idle potential);
logistics' bill scales with the work-budget actually consumed by transfers. The standing-cost job
belongs to maintenance, which scales with built stock. Bills accrue catchUp-scaled (interval
invariance) and are reference-valued; exact rates are harness calibration.

- **Construction** — funded fraction scales how much of the physical pool's throughput runs. The
  `work ÷ absorbed` floor stands; backlog-frontier pricing and emergent build duration are
  untouched.
- **Logistics** — same shape against the logistics work-budget. The funding slider is itself the
  first logistics player verb (how much of the work-budget runs), distinct from the
  route-directing verb deliberately not built yet. (Future: logistics gets its own
  point-generating buildings — the Construction Centre parallel — making the two bands
  structurally symmetric.)
- **Maintenance** — the standing sink; see next section.

## Maintenance (the standing sink)

Every building level carries a reference-valued, type-weighted maintenance cost; the faction-wide
bill is itemised per building type in the UI. One **global** slider in v1 — Paradox precedent keeps
maintenance sliders coarse, and per-group triage sliders are a purely additive later split if
playtesting wants them (the itemised bill is already the structure).

**Design rule: player choice may only charge flow; only insolvency may touch stock.** Stock
destruction (lost building levels) compounds into a death spiral; flow costs are recoverable,
which is what makes the slider a *usable* budget lever rather than a self-harm dial.

- **Base idle decay always runs, scaled by effective maintenance funding.** The existing
  idle-decay machinery (buffered idle contraction) never switches off; funding modulates its
  aggression via the idle-buffer length. At 100% funding it is *gentler than today* (a deliberate
  rebase — base decay is currently a bit harsh); today's constants sit near the mid-scale point;
  at very low effective funding the buffer is short and idle capacity dies fast.
- **The player slider is floored at 50%.** The slider's whole range (50–100%) charges only flow: a
  recoverable output malus scaling with the shortfall (order of −2–3% output at 90% funding).
  Deliberate budget-crunch lever: run lean, produce less, recover fully.
- **Effective funding below 50% is reachable only through insolvency** (the paid fraction is the
  effective funding level — see Settlement). Below 50%, decay aggression ramps past today's
  strength. Even at 0%, a fully-staffed, fully-utilised building keeps its levels — the engine's
  idle channel cannot touch a building with no idle levels, and v1 deliberately adds no new decay
  channel ("working machines crumble from total neglect" is a booked future note, not v1).
- **Implementation trap (load-bearing):** the output malus must NOT feed the idle-detection
  signal. Decay's idle check runs off `buildingUsed` utilization — the malus must scale output
  *after* utilization is measured, or the flow-only promise silently breaks.

## Settlement (cadence, ladder, deficit)

The month pulse (`MONTH_LENGTH`), the construction pulse (`CONSTRUCTION_INTERVAL`), and the
logistics pulse (`LOGISTICS_INTERVAL`) are three independent knobs (all 24 ticks today). The
treasury does not follow the bands' pulses: it settles **once per month**, in one resolution —
otherwise an off-cycle band pulse could drain the treasury out of ladder order under a future
cadence retune.

- **Collect, then spend, within the same settlement.** Income (both lines, from the month just
  produced) enters first; bills are then paid in the fixed priority ladder **maintenance →
  logistics → construction**. Flow-vs-stock decides the order: construction stalling is fully
  recoverable (the queue waits), unpaid maintenance compounds. The ladder is fixed, not
  player-orderable — sliders set priorities in normal times; the ladder is only the emergency
  order, and it gives AI factions sane crisis behaviour for free.
- **Funded fractions latch for the following month.** Each band's paid-fraction from this
  settlement is what its pulse(s) use next month. This is a deliberate one-month lag (the malus
  applied during a month uses last settlement's funding) — the same funding-off-month-start shape
  already analysed and accepted for construction; the lever for responsiveness, if ever needed, is
  a finer economy cadence, not settlement reordering.
- **The paid fraction is the effective funding level** — a band shorted by the ladder behaves
  exactly as if its slider were at the paid level. This is how insolvency reaches the maintenance
  decay zone (below the 50% slider floor) — the destructive regime is reached through real
  insolvency only, never by nudging a slider. **Zero-bill guard:** when a band's bill is 0 (empty
  construction queue, no transfers), effective funding = the slider value — never 0/0 (NaN is a
  save-corrupting hazard).
- **No debt.** Balance clamps at ≥ 0.
- **Queue staleness (accepted, noted):** a long-starved construction band's auto-build rows
  persist unfunded; when funding returns the queue thaws in stale ROI order. Broadly "the queue
  waits" holds; one-line caveat, not a redesign.

## Initial state

Treasuries start at **zero** — no seeded windfall (no magic numbers). Collect-then-spend means
month one's income pays month one's bills, so a solvent start is a *calibration outcome* (tax
rates vs bill rates), not a handout. The harness watches early-game solvency explicitly — the
opening eras (including the pre-logistics warm-up) must not stall by bookkeeping accident; if they
do, tune rates. If calibration shows minimal starting help is genuinely warranted, the balance is
*calculated from the world* (e.g. a small multiple of the homeworld's own maintenance bill —
identical for every faction, since all start states are), never an arbitrary constant.

New-game/world-gen adds the per-faction treasury rows; save-format changes ride the standard
`SAVE_FORMAT_VERSION` bump (old saves fail cleanly by convention).

## AI parity

Same-brain: **every faction** — player, the 8 majors, and all minor factions — runs the identical
treasury (major/minor is legacy flavour; it may influence world-gen seeding someday, never
mechanics). v1 defaults: all three bands at 100%; tax level government-flavoured. No hand-authored
budget personalities — the priority ladder under income pressure produces more honest
differentiation than authored allocations would. The player seat starts from the same defaults.

## Harness metrics (the coarse health bar for money)

The treasury is faction machinery, not player machinery — it runs identically in the playerless
calibration harness, across the full faction roster (majors + minors). Per-faction, over a run:

- **Balance trajectory** — no runaway hoards (a monotone hoard means the maintenance sink is
  undersized against income) and no designed-permanent insolvency; solvency dispersion across the
  roster; **early-game solvency** explicitly (the zero-start opening must be viable by
  calibration).
- **Funded-fraction distribution per band** — how often construction actually starves (some
  scarcity is desired; permanently pinned at 0 is a fault), whether logistics funding ever
  throttles transfers (the colonisation lifeline).
- **Income composition** — heads vs production shares, per system and per faction (which systems
  carry the treasury — the observable this design wants to surface).
- **Standing guards** — no NaN, no negative balances, clamp at zero, JSON-safe, S-invariance
  (treasury identical across ECONOMY_SCALE values).

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

### Neglect wear on staffed buildings

At 0% effective maintenance, v1 leaves fully-utilised buildings intact (the idle channel can't
touch them, and adding a third decay channel isn't worth its engine cost yet). If total neglect
should eventually crumble even working machines, that's a new, explicitly-owned decay channel —
design it then, don't imply it.

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
