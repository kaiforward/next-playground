# Necessity-Weighted Unrest — Not Every Empty Shelf Is a Famine

## Headline

Every good a population wants currently hits unrest with the same instrument. A system with full food
and water and empty luxuries is graded like a system in famine, because the fold that picks the unrest
accumulation rate fires on the **worst single demanded good** — one good below half-satisfaction flips
the whole system into the fast rate. In the barren-by-design galaxy nearly every system carries a
chronic higher-tier deficit, so the fast rate is the ambient state rather than the exception, and the
galaxy strikes and collapses for reasons that are not emergencies.

The change is one authored table, one bound, and one guarantee:

- **`GOOD_NECESSITY`** — a per-good weight on how much *not having it* counts, sitting beside
  `GOOD_CONSUMPTION` as a peer table. Water and food weigh full; luxuries barely register. People still
  want the luxuries; the model just stops calling not having them suffering.
- **Named unrest ceilings per regime** — the accumulation gains are re-expressed as
  `gain = ceiling × decay`, so each regime carries a stated maximum equilibrium unrest instead of a
  ratio tuned blind. The Shortage ceiling is high: losing water or food entirely must be able to
  collapse a system.
- **A survival-good floor** — water or food below `SHORTAGE_SATISFACTION` selects Shortage outright,
  whatever the rest of the basket looks like.

Demand is unchanged except for the deletion of the government consumption boost (below), whose blast
radius is the eight goods those governments boosted. Pricing geometry, the ration threshold, logistics
matching, planner capacity sizing and infrastructure decay are otherwise untouched — the rest of the
change lives in the fold from per-good satisfaction to system unrest.

The weights do the grading; the ceilings make the guarantee. A luxuries drought produces grumbling that
*adds* to tax pressure and to other goods' shortfalls — so high tax plus a broad multi-good shortage
still crosses into striking — but luxuries alone provably cannot get there.

## Why the current model cannot express necessity

**Tier is wearing three hats and pretending to be three signals.**

| Signal | What it looks like | What it actually is |
| --- | --- | --- |
| `GOOD_CONSUMPTION` per-capita need | a necessity ranking | a tier gradient — its own docstring says "higher tier → lower need… only their relative shape matters" |
| `GOODS.priceFloor` / `priceCeiling` | per-good price behaviour | a pure tier lookup: **every** tier-0 good is 0.5–2.0, every tier-1 0.5–2.5, every tier-2 0.5–3.0, with zero per-good variation |
| `GOODS.volatility` | how sharply a good reacts | authored for trade flavour, read by nothing (dead field); it puts medicine at 1.5, near the top — backwards for necessity |

The consequence is concrete: **medicine's per-capita need (0.001) sits below gas's (0.004)** purely
because medicine is tier-1 and gas is tier-0. Nothing in the data says people need medicine less than
gas. Any fold that reads consumption volume as importance inherits that inversion — which is why
necessity has to be its own authored number rather than a proxy derived from an existing one.

## The government consumption boost is deleted in the same pass

`GOVERNMENT_TYPES[…].consumptionBoosts` adds a **flat, population-independent** term inside
`consumptionRate` — federation `{ medicine: 1 }`, militarist `{ weapons: 1, fuel: 1, machinery: 1 }`,
and so on. At `ECONOMY_SCALE` that term is 100 units per system regardless of whether the system holds
a thousand people or two:

| Federation system | the boost's share of the demand basket |
| --- | --- |
| pop 1000 | 2.4% — plausibly what the constant was authored against |
| pop 26 | ~48% |
| pop 2 (a fresh colony seed) | **~92%** |

It is a constant authored for a typical developed system and applied at every population, so it
distorts *small* systems hardest. Its damage is not theoretical: the colony founding manifest sizes
each line as `FOUNDING_STOCK_ANCHOR_FRAC × TARGET_COVER × consumptionRate`, so a 2-pop federation seed
asks its founder for ~3006 medicine against ~36 food — the endowment is ~99% medicine by quantity, and
founding a colony strips the founder's entire drawable medicine reserve. Under any necessity weighting
a colony would also read as a permanent famine from birth on a good it cannot produce.

The boost is removed outright rather than re-based per-capita. Government types keep their event
weights and danger baseline and become economically inert until the government layer is revisited;
that is an accepted, temporary loss of texture, and it buys clean economy/colonisation/logistics
readings now.

### The deletion does move demand — for eight goods

The boost sits **inside `consumptionRate` itself**, which `civilianDemandRateForGood` and
`totalDemandRateForGood` wrap and which every downstream `demandRate` consumer reads. Deleting it
therefore moves demand for **medicine, luxuries, weapons, fuel, machinery, food, electronics and
textiles**, at the governments that boost them — up to a 5× drop at a mid-size system (a militarist
system at pop 500 sees weapons demand fall from 125 to 25). For those goods and only those goods, the
following move with it: the price anchor `targetStock`, the emergency ration threshold, the producer
operating ceiling and hence the infrastructure-decay glut signal, `classifyMarketState` /
`surplusDrawable`, the planner's `capacityGap`, world-gen seed stock, the homeworld prefab stamp, and
colony founding manifests.

The expected transition is a one-off correction: standing stock sized against the boosted anchor reads
as glut, producers throttle, and the idle channel prunes the capacity that phantom demand justified —
while the planner will not rebuild it, because the demand it was sized against is gone. **That is the
correct outcome.** The capacity was built to serve demand that was never real; if the simulation
depended on those modifiers, the dependence was a hidden defect rather than a feature. It is booked as
a validation target rather than softened, because the sim is the instrument that tells us whether the
correction overshoots.

There are no save files to migrate — the world is regenerated — so no phase-out is needed.

Removing the term also unthreads `governmentType` from `consumptionRate` and `capacityGoodRates`, drops
the `government` term from `ConsumptionBreakdown` and its API row, removes the Government segment from
the Population panel's needs breakdown, and drops the `consumptionBoosts` key from
`GovernmentDefinition`. The three assertions that require a positive government term are deleted with
it, not re-based. `governmentType` becomes a dead field on `SystemBuildRow` and the directed-build /
directed-logistics world rows and is pruned from them. Two docstrings state behaviour that stops being
true and are rewritten with the change: the homeworld prefab's (`computeHomeworldBuildings` becomes
identical for all eight governments, so its `governmentType` parameters go with it) and the dynamic
`ECONOMY_SCALE` invariance bridge's, which names the government consumption scaling as one of the two
things it exists to exercise — the deletion removes the only flat scaled demand term in the civilian
path, and that coverage loss is accepted explicitly rather than silently.

## Measured evidence — do not re-derive

All figures from the shipped constants, **after** the government boost is removed, which makes the
unskilled basket population-independent (no flat term, so the same shares at any population).
26 goods carry positive civilian demand; every settled system carries a market row for every good, so
the fold sees the whole basket. Unsettled systems have no market at all and are not part of any fold.

### Per-good demand share, ordinary unskilled world

| Good | Share | Good | Share | Good | Share |
| --- | --- | --- | --- | --- | --- |
| water | 17.03% | fuel | 3.65% | medicine | 2.43% |
| food | 14.60% | metals | 3.65% | radioactives | 1.95% |
| gas | 9.73% | chemicals | 3.65% | machinery | 1.95% |
| ore | 4.87% | consumer_goods | 3.65% | munitions | 1.22% |
| textiles | 4.87% | polymers | 2.92% | hull_plating | 1.22% |
| minerals | 4.87% | alloys | 2.43% | weapons | 1.22% |
| biomass | 4.87% | components | 2.43% | luxuries | 1.22% |
| | | electronics | 2.43% | targeting_arrays | 0.97% |
| | | | | weapons_systems / reactor_cores / ship_frames | 0.73% each |

Tier-0 totals 62.8%, tier-1 27.3%, tier-2 10.0%. **All tier-1+2 = 37.2%** — the barren-chronic deficit.

Basket composition still shifts with skilled heads, which is required behaviour: importance must come
from what a population actually consumes, and the engineer basket is luxuries-exclusive, so an
engineer-heavy world genuinely does want more luxuries than a mining colony. Necessity weighting is
orthogonal to that — it changes how much the *shortfall* counts, not how much is wanted.

### What satisfaction actually measures

`satisfaction` is a **flow**: delivered ÷ demanded for one good in one pulse. It is not a stock gauge,
and the distinction decides where every threshold in this document sits. Delivery is **full** while
stock covers at least `RATION_COVER` (2) pulses of demand; below that it ramps as `√(stock / rationStock)`.
The pricing anchor is `TARGET_COVER` (40) pulses. Because an economy pulse is one cycle, **cover is
measured in cycles, not days** — the "days-of-supply" wording in the shipped docstrings is legacy and
should be corrected where it appears.

| Stock (cycles of demand) | Satisfaction | State |
| --- | --- | --- |
| 40 — the pricing anchor | 1.00 | normal |
| 20 — half the strategic reserve | 1.00 | reserve drawing down, nobody hungry |
| 2 — the ration knee | 1.00 | on the knee |
| 1 | 0.71 | 71% rations |
| 0.5 | 0.50 | half rations |
| 0 | 0 | nothing delivered |

So a healthy system's `D` is **exactly** zero, not approximately — every gap is exactly 0 while stock
sits anywhere above the knee. And satisfaction 0.5 means people are receiving half of what they need
to eat, with under half a cycle in the warehouse: it is already a severe state, not a mild squeeze.
`RATION_COVER = 2` stands as authored — an underfilled strategic reserve is genuinely not an unmet
current need, and the gap between the deficit signal (0.8 × anchor, i.e. 32 cycles) and the knee gives
roughly 30 logistics pulses of warning, with logistics resolving every pulse. **A system that starves
never ran out of warning; it ran out of supply or of budget to move it** — so widening the buffer is
never the fix for a starving galaxy.

### Why the previous fold failed, in one line

Summed demand share cannot separate the two cases: a total water failure covers 17.0% of the basket
while the ambient chronic deficit covers 37.2%, so no cut grades the acute case worse than the
ambient one. That is a **missing-weight** problem, not a structural limit of summing — eighteen goods
nobody needs badly should not outweigh the one good everybody needs absolutely. Adding the weight
fixes it (next section). The genuinely disqualified approaches are those that read necessity off an
existing signal: consumption volume (`maxWeight`, `maxContrib`) inherits the medicine-vs-gas
inversion, and anything gated on a satisfaction cliff scores water at 0.49 identically to water at
0.00 while real severity differs fourfold.

## The fold

Vocabulary: `sat_g` is per-good civilian satisfaction (delivered ÷ demanded, the flow measured at the
economy pulse); `demanded_g` is that good's civilian demand.

```
weight_g   = demanded_g × necessity_g
share_g    = weight_g / Σ weight
D          = Σ share_g × (1 − sat_g)²
```

Three properties, none of which the current fold has:

1. **`necessity_g` is authored, not derived.** It is the one thing in the model that says a good is
   needed rather than merely bought, and every attempt to read it off tier, price band, or consumption
   volume gets it wrong (see the table above).
2. **The convex `(1 − sat)²` shape is unchanged.** A deep shortage still dominates many shallow ones;
   this pass changes *whose* shortage counts, not how severity scales.
3. **No per-good contribution cap.** An earlier draft carried one; it is provably inert at the authored
   weights, because a good's term can never exceed its own weighted share and the largest non-survival
   share is gas at 0.085 — which settles below the strike threshold with no cap at all. A cap tight
   enough to bind would score a good at half supply identically to that good at zero, reintroducing
   exactly the severity-blindness this document disqualifies satisfaction-gated folds for. The
   guarantee it was meant to provide is delivered by a **test** instead (see Validation): no
   non-survival good, alone, at any tax level, can reach the strike threshold. That is a claim about
   the constants, and a test enforces it better than a runtime `min()`.

`GOOD_NECESSITY` is total over `GOODS`, asserted by a test beside the existing basket-subset assertion,
so adding a good without a necessity weight fails the build rather than silently dropping it from the
fold. The fold returns 0 when `Σ weight ≤ 0`, mirroring the existing zero-demand guard.
`GoodSatisfaction` gains a `goodId` so the engine can resolve `necessity_g` from the id — the weight is
never passed in pre-resolved, so the fold's call sites cannot diverge on the table. All three
constructors already hold the id and currently discard it.

### Regime selection, and the two levels of labelling

There are two distinct labelling systems in this design, and the spec states which is which because
conflating them is what produced an earlier draft's constant mix-up:

| Level | Describes | Computed from | Owner |
| --- | --- | --- | --- |
| **Per-good chip** — Supplied / Low reserve / Rationing / Shortage / Glut | one good in one system | that good's **stock cover** and satisfaction | the presentation pass (PR6) |
| **System regime** — Supplied / Rationing / Shortage | the whole system | **`D`** | this slice |

The per-good chips do not read `D` and cannot — `D` is a system-wide aggregate. They are also where the
early warning lives: "Low reserve" is a system whose strategic reserve is drawing down while everyone
is still eating, which is precisely the state the unrest model is deliberately blind to.

The system regime is:

- **`supplied`** — `D` is exactly 0. Reachable exactly, so no epsilon is needed; if a good persistently
  parks a hair under full satisfaction the presentation pass can revisit it.
- **`rationing`** — `D` above 0 and below the shortage cut.
- **`shortage`** — `D` at or above the shortage cut (initial 0.25), **or** water or food below
  `SHORTAGE_SATISFACTION`.

The **survival-good floor** is not a fallback; it is the mechanism that makes the survival guarantee
explicit rather than hoping it emerges from a squared average. Because `D` squares the gap, water at
49% delivered folds to only 0.10 and water *and* food both at half fold to 0.17 — both below any
workable cut, and both states in which a population is genuinely on half rations. Water would have to
fall below ~18% delivered before `D` alone caught it. The floor closes that band and gives
`SHORTAGE_SATISFACTION` (0.5) a live sim consumer, so no constant is orphaned.

**There is no regime hysteresis.** An earlier draft carried enter/exit bands; the smoothing below makes
them unnecessary in the simulation, and nothing in the world persists a regime for them to hang on. Any
label steadiness the chips need is a display concern decided in the presentation pass with display
tools. No new stored state ships in this slice.

### The unrest ceilings ship with the fold

The accumulation gains are re-expressed as `gain = ceiling × decay`, so equilibrium under sustained
dissatisfaction is `floor + ceiling × D` and each regime carries a *named* bound instead of a ratio
tuned blind. The integrator's shape is untouched: the tax floor remains the exact equilibrium at
`D = 0`, and the Shortage ceiling stays strictly above the Rationing one.

**The ceilings are a co-requirement of this slice, not an optional tidy-up.** Two of the arc's
guarantees are jointly unsatisfiable with a single ceiling:

- Sustained Rationing must never reach collapse, at any tax → ceiling below **2.08**
- A total food failure must collapse, even at zero tax → ceiling above **2.34**

No single number satisfies both, so the two-regime structure is load-bearing: famine genuinely needs a
steeper response than ordinary scarcity, not merely a larger `D`. First cuts, simulator owns finals:
Rationing **1.8**, Shortage **2.5**. Both containment guarantees are computed from the shared constants
and never hardcoded as sums.

**The ceiling is blended across the cut, not switched.** A hard branch would double a system's settled
unrest for an arbitrarily small change in delivered goods — reinstating on `D` exactly the cliff this
pass removes from per-good satisfaction, and landing the step across strike onset. Instead the ceiling
ramps continuously from the Rationing value to the Shortage value across a band at the cut, shaped so
that the Rationing containment guarantee still holds at the top of the band. Unrest accumulation
doubles only when the shortage itself roughly doubles. The regime *label* stays a discrete cut on the
same `D`; the simulation underneath it is continuous everywhere.

### First-cut necessity values

Coarse first draft; the simulator owns the finals, and only the relative shape matters.

| Band | Goods | necessity |
| --- | --- | --- |
| Survival | water, food | 1.0 |
| Health | medicine | 0.8 |
| Daily life | gas, textiles | 0.4 |
| Broad utility | consumer_goods, fuel | 0.3–0.35 |
| Industrial staples | biomass, chemicals, electronics | 0.15 |
| Industrial inputs | ore, minerals, metals, polymers | 0.1 |
| Discretionary / military | radioactives, alloys, components, machinery, luxuries | 0.05 |
| Pure war matériel | munitions, hull_plating, weapons, weapons_systems, targeting_arrays, reactor_cores, ship_frames | 0.01–0.02 |

### What those values do to the measured scenarios

Weighted denominator ≈ 45.70 (in units of raw-basket %). Full-loss scenarios:

| Scenario | D today (unweighted) | D under this fold | Regime |
| --- | --- | --- | --- |
| Water empty alone | 0.170 | **0.373** | Shortage |
| Food empty alone | 0.146 | **0.320** | Shortage |
| Water + food empty | 0.316 | **0.692** | Shortage |
| All tier-1+2 empty (barren-chronic) | 0.372 | **0.141** | Rationing |
| Luxuries empty alone | 0.012 | **0.001** | Rationing |

Partial-deprivation scenarios, which the cut alone cannot separate and the survival floor therefore
owns:

| Scenario | D | Selected by |
| --- | --- | --- |
| Water at 50% | 0.093 | survival floor → Shortage |
| Water at 20% | 0.239 | survival floor → Shortage |
| Water + food both at 50% | 0.173 | survival floor → Shortage |
| Ambient tier-1+2 at 50% | 0.035 | Rationing |

The ordering inverts the right way. Today the ambient deficit scores **2.2× a total water failure**;
under the weighted fold a water failure scores **2.6× the ambient deficit**. Any shortage cut in
`(0.141, 0.319]` — initial 0.25 — grades total famine as Shortage and ambient scarcity as Rationing,
which is the two-sided goal a summed *unweighted* share could not reach at any cut. The interval's
endpoints are the two scenario `D` values themselves, so a calibration pass that moves any necessity
weight must re-derive them.

### Why this fixes the striking galaxy

Unrest settles at `floor + ceiling × D`, and an uncrowded system declines exactly when
`unrest > 1 − D` (growth is `rate × pop × (1 − D)`, decline is `rate × pop × unrest`, at equal rates).

| | Today | Under this fold |
| --- | --- | --- |
| Ambient D | 0.372 | 0.141 |
| Regime selected | shortage (worst-good cliff) | rationing |
| Equilibrium unrest (tax floor 0.05) | 0.05 + 2×0.372 = **0.82** | 0.05 + 1.8×0.141 = **0.30** |
| vs strike threshold 0.65 | striking | calm |
| vs collapse threshold 0.75 | collapsing | far below |
| Declines when unrest > | 0.63 → **net decline** | 0.86 → **strong net growth** |

That is the observed symptom — too many systems striking, systems collapsing, expansion stalling in a
galaxy with no hard mechanics working against it — and it is arithmetic, not a tuning accident: the
ambient deficit was selecting the catastrophe rate and then being integrated at double gain.

The old ratio also fails in the other direction, which is why the ceilings are not optional: at the
shipped Shortage gain, a **total food failure settles at 0.639** against a decline threshold of 0.681,
so a world with no food at all would have *grown* at low tax and would not even have struck. Water
cleared the bar only because its basket share is 2.4 points higher. The Shortage ceiling is what makes
"survival goods can drive collapse" true of both.

## Interactions — the full sweep

**Reads `D`, must be re-checked:**

- **Population processor** — unrest integration and the `(1 − D)` growth term. The intended consumers.
- **The build planner's `fed()` housing gate.** Its fold currently weights by civilian **+ industrial**
  demand, but `GOOD_NECESSITY` is authored on the civilian axis, so applying it to a refinery world's
  ore draw would collapse that world's `D` however starved its factories are. The gate's fold therefore
  becomes **civilian-only and necessity-weighted**, meaning exactly one thing: *are the people here
  fed?* Industrial-input starvation stops blocking housing, which is correct — industry is a route out
  of a famine, not a reason to refuse shelter, and `fed()` gates housing alone (it has one caller and
  has never gated industry). `D_SETTLE` is re-cut against the new distribution.
- **`POPULATION_PARAMS`' symmetric growth/decline rates**, whose docstring justifies the symmetry
  *in terms of* "an unavoidable D ≈ 0.4". That premise is what this pass deletes; the docstring is
  rewritten with the change, not blindly preserved.
- **The needs-ledger display projection** (`computePopNeeds`). Its `pressure` term is an explicit mirror
  of the fold's demand-share × gap² shape and is the panel's **sort key**, surfaced through the API as
  "this good's contribution to unrest". It takes the necessity weight in this pass, or the ledger would
  rank a luxuries shortfall above a medicine one while the simulation ranks the opposite. Its docstring
  mirror claim is updated with the change.
- **Harness metrics** that fold satisfaction or `D` (`build-analysis`, the regime-share read). The
  colony "opened deprived" instrument takes the same weighting, or records the colony's opening regime
  directly, so the colony validation target below is actually measurable.

**Reads unrest, must be instrumented:** this pass takes ambient equilibrium unrest from ~0.82 to ~0.30
galaxy-wide and clears the strike flag almost everywhere. Four shipped mechanics read unrest or that
flag, and all four change behaviour at the same pulse. Every one of their constants was calibrated
against the striking galaxy, so none is pre-tuned here — they are **measured before and after, and
retuned only where the sim shows a problem.** Tuning them now would be tuning against a galaxy that
does not exist yet.

- **The purse.** Production tax is levied on realized output, which strike suppression currently cuts
  to ~64% galaxy-wide; ending the ambient strike raises the tax base ~1.5× in one pulse while
  maintenance bills, which scale with standing build work, do not move. Funded fractions and the
  maintenance output malus both shift.
- **Directed logistics.** `surplusDrawable`'s deep-exporter path is gated on the strike flag, so today
  **no** exporter is drawable below its anchor. The flag clears everywhere and structural exporters
  become drawable down to their strategic reserve — haul volume and the logistics bill step up.
- **The build planner's squeeze-feedback backstop.** `strikeExplains` silences the feedback gap
  wherever a system holds capacity in a rationed good, i.e. almost everywhere today. It switches on
  galaxy-wide at the same pulse that de-suppressed output raises exporter spare and covered fraction —
  two effects pushing opposite ways, resultant not derivable from the constants.
- **Infrastructure decay swaps channels.** The unrest-teardown channel fires at essentially every
  settled system today and goes to exactly zero after this pass — correct, but it leaves the 12-cycle
  idle channel as the only pruner at the same moment rising output pushes stock toward the operating
  ceiling and turns strike-throttled producers into glut-idlers.

The expectation is that all four respond well: this is what a healthy economy looks like, and the
sequencing intent is deliberate — get the economy running properly in a universe with little working
against it, *then* decide how events and other mechanics make survival hard again. Difficulty layered
onto a broken baseline only hides which part is broken.

**Also affected:** the five-band stability ramp (map choropleth and system badge) bands unrest at
0.2/0.4/0.6/0.8; post-change every healthy system sits in the bottom band and three of five bands
become famine-only. Re-cut the stops against the measured distribution, or fold it into the
presentation pass with the other display work — it is currently in neither.

**Explicitly untouched, for the eighteen unboosted goods** — every one of these reads `demandRate`, and
for those goods `demandRate` does not move: market bands and the price anchor, the emergency ration
threshold, the producer operating ceiling and therefore the infrastructure-decay glut signal, directed
logistics' deficit/surplus classification and severity ordering, the build planner's capacity sizing,
colony founding-stock sizing, and world-gen seed stock. For the eight boosted goods every one of those
*does* move; see the deletion section above.

**Naming.** The primitive is `necessity`, not `elasticity` — the earlier framing (necessity as a
demand curve's slope, with demand physically contracting under scarcity) is abandoned. `elasticity` is
also already taken: `DEFAULT_ELASTICITY` / `MarketCurve.k` is the price-curve exponent, with the
opposite polarity (a good whose price should react *most* sharply carries a *high* `k`).

## Sequencing

This slice comes before the arc's presentation PR (PR6). PR6's regime chips name states across the
panels, and this is what settles what those states mean — building them first would mean naming states
the simulation is about to redefine, which is exactly why presentation was split out. PR6 inherits the
per-good chip bands, any label steadiness those chips need, and the stability-ramp re-cut if it is not
done here.

Two follow-ons are booked, not built here: making per-good price response real (a per-good
`MarketCurve.k`, which delivers "water spikes under scarcity, luxuries don't" without touching demand
at all), and the government layer's revisit, which decides what — if anything — replaces the deleted
consumption boosts.

## Validation

Harness targets, on top of the existing coarse health bar:

- **Striking share collapses**, and **collapsed/stranded systems approach zero**. With no hard
  mechanics currently working against expansion, a healthy galaxy should show very few of either;
  both were the loudest signal that the shipped constants were compounding rather than correcting.
- A system supplied in its high-necessity goods and short only in low-necessity ones stays off the
  fast rate and settles below the strike threshold.
- **No non-survival good, alone, at any tax level, can reach the strike threshold** — asserted as a
  test against the necessity weights and the ceilings, not merely observed in a run. This is the
  guarantee the deleted per-good cap was meant to carry.
- **Sustained Rationing cannot reach the collapse threshold at any tax level**, and **a total water or
  food failure both selects Shortage and drives net population decline at every tax level, including
  the lowest** — the case the shipped gain ratio failed.
- A broad lower-tier shortage stays calm at normal tax but *can* cross into striking when stacked with
  overcrowding and very-high tax, while staying below collapse. Only famine collapses.
- Colonies no longer open in the Shortage regime; founding manifests are food/water-weighted at a
  small seed, and founding a colony no longer strips the founder's medicine.
- **Built capacity in the eight boosted goods stabilises** over a long run rather than ratcheting
  toward zero — the one-off anchor correction must not become a permanent teardown.
- Before/after readings for each of the four unrest consumers above: faction solvency and funded
  fractions, transfers per logistics pulse, levels committed per build pulse, and levels shed per
  decay channel.
- The per-**system** share of the three `SupplyRegime` classes is reported in the simulate output — the
  permanent instrument for this pass and future economy work. (The per-good five-state chip metric is
  the presentation pass's, and depends on constants this slice does not ship.)

Expect `ECONOMY_SCALE` ratio-invariance to hold by construction (necessity is a dimensionless weight,
the ceilings are dimensionless bounds), but re-run the invariance bridges: removing the government
boost changes S=1 output, so fixtures move.
