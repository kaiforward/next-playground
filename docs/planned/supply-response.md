# Supply Response — Make the Score Mean Something, Then Let It Drive

## Headline

A world's supply state is folded into one number, `D`, which drives unrest. That number has stopped
carrying information. In a working galaxy its mean sits at **0.030** while the unrest slopes that
consume it were cut against an ambient level of **≈0.14** — so the supply term contributes almost
nothing and unrest is now mostly tax and crowding wearing a supply label. At the same time the
regime label built from it grades **62.7%** of all worlds as "Rationing" while they are, in fact,
fine.

Both symptoms are the same cause: **the fold squares each good's shortfall**, which crushes the
usable range into the bottom tenth of the scale and makes the resulting number impossible to author
thresholds against. It is not a percentage and cannot be read as one — a mean of 0.030 corresponds
to roughly a 17% average shortfall, not a 3% one.

The change is one measure, one demotion, and one resolution:

- **The score becomes a supply percentage.** Weighted mean satisfaction instead of a weighted mean of
  squared gaps. "This world is getting 83% of what it needs" becomes literally true, spans a usable
  range by construction, and can be authored against in the units a designer actually thinks in.
- **Bands stop gating anything.** Supplied / Strained / Rationing / Shortage become description. No
  gameplay effect keys off which band a world is in; effects scale off the percentage. Where the
  boundaries sit becomes a legibility choice rather than a balance risk.
- **Permanently struck worlds resolve.** A world that can physically recover gets a route back; a
  world that cannot is allowed to fail. Today neither happens and they park forever, polluting every
  galaxy-wide reading taken over them.

Severity guarantees do not come from the shape of the curve. They come from explicit overrides — the
survival-good floor already works this way, and famine remains a step change rather than an average.

## Why the current model cannot grade a working galaxy

**The squaring is doing two jobs and only one of them was wanted.** It was chosen so that severe
shortfalls dominate minor ones, which is correct. But squaring a quantity in [0,1] also compresses
the whole scale toward zero, and that compression is what removed the signal:

| | folded with squaring | as a plain shortfall |
| --- | --- | --- |
| a uniform 17% shortfall across the basket | 0.030 | 0.17 |
| what the unrest slopes were cut against | ≈0.14 | ≈0.14 |

The slopes were authored for the right-hand column and are being fed the left-hand one. The fixed
point of the unrest integral is `floor + slope × D`, so a fivefold shrink in `D` is a fivefold shrink
in everything supply contributes. Nothing is wrong with the slopes; they are being handed a number
that no longer spans the range they were written for.

**Supplied requires perfection.** The system label is `D > 0 ? rationing : supplied` — exactly zero,
not approximately. A world must receive every good it demands, in full, simultaneously. Across a
basket of 26 goods that essentially never happens, so two thirds of a healthy galaxy carries the
label meant for worlds in difficulty. The label is not mis-calibrated to the wrong number; it is
calibrated to a number that means "flawless".

**The label gates recovery speed.** `accumulateUnrest` selects the relaxation rate from the regime —
the fast `recoveryDecay` when Supplied, the slower `decay` otherwise. This does not move where unrest
settles, only how quickly it gets there, so the effect is milder than the label's prominence
suggests. It is still a cliff at exactly zero, and it is the only place a band currently decides
anything.

## The score becomes a supply percentage

Each good a world demands has a satisfaction in [0,1]. Weight each by its demand share times its
authored necessity — the existing `GOOD_NECESSITY` weighting, unchanged — and take the mean. That is
the world's **supply percentage**: the share of what it needs, weighted by how much it needs it.

Read directly:

- 100% — everything demanded arrived in full
- 83% — the galaxy's current typical world
- 50% — half of what this world needs, weighted by importance, is not arriving

The quantity the unrest integral consumes is its complement, the **shortfall** (`1 − supply%`), which
occupies the same role `D` does today and spans the range the slopes were originally authored for.
Whether the existing slope constants are already approximately correct against the un-squared
quantity is a measurement, not an assumption — the range coincidence is suggestive and must be
confirmed before anything is re-cut.

**What the squaring was protecting, and what replaces it.** Averaging dilutes a severe shortfall in
one good against plenty elsewhere. That protection moves to explicit overrides rather than living in
the curve's shape:

- **The survival floor stays as-is.** Water or food below `SHORTAGE_SATISFACTION` selects Shortage
  outright and promotes the unrest slope, whatever the average says. Famine is never averaged away.
- **A critical-good override extends the same shape** to any good below `SHORTAGE_SATISFACTION`,
  scaled by that good's necessity weight, so a severe medicine gap still bites without the whole
  scale being bent to achieve it.

This is the structure Victoria 3 uses: one continuous scalar, plus targeted overrides where something
must always matter. The scalar stays readable because it is not carrying the severity logic.

## Bands become description

Four bands, on the supply percentage:

| Band | Rule |
| --- | --- |
| **Supplied** | nothing below ~90% — trickle shortfalls are normal and unremarkable |
| **Strained** | worst demanded good between 50% and 90% |
| **Rationing** | worst demanded good below 50% |
| **Shortage** | a *survival* good below 50% |

Three of the four boundaries already exist as authored constants: `SHORTAGE_SATISFACTION` is the 50%
line, and `SURVIVAL_GOODS` is the famine distinction. Only the ~90% Supplied boundary is new, and it
answers "how short before a player should care" — a legibility question, not a balance one.

**No gameplay effect reads the band.** The relaxation-rate switch is removed and the rate becomes a
single value; effects that should vary with supply read the percentage. This is the load-bearing part
of the demotion: once nothing is gated, the boundaries can be moved on taste without a recalibration,
and they can never again be the reason a healthy galaxy reads as struggling.

Bands are chosen from the *worst affected good* rather than the average, because that is the question
a player is asking when they look at a list of worlds. The average answers "how well supplied is
this world"; the band answers "is anything wrong here". They are different questions and the model
should not force one number to answer both.

## Unrest responds to change as well as level

Unrest currently reads only the level of shortfall. A world that has been poor and stable for a
century and a world that lost half its supply last cycle settle at the same place, which is not how
populations behave and not what a player wants surfaced.

The addition is a **change term**: unrest rises when supply is falling and eases when it is
recovering, on top of the level response. This is the mechanism Victoria 3 leans on hardest — its
headline radicalisation is on standard of living *moving*, not on its absolute value — and it is what
lets a recovering world visibly recover rather than merely stop getting worse.

**This is separable and should be evaluated second.** Restoring the score's range may be sufficient
on its own; adding a derivative term at the same time would make it impossible to attribute which
change did what. Ship the percentage, measure, then decide.

## Struck worlds resolve

Worlds above the strike threshold suppress their own production, which reduces supply, which raises
unrest. The loop is self-reinforcing and has no exit: growth carries `(1 − D)` and decline carries
unrest, so at high shortfall the two terms cancel and the world parks indefinitely. Measured, a
small cohort sits there permanently with none of them declining.

They need resolution for two reasons. As gameplay, a stuck world with no route out and no way to fail
is dead content. As instrumentation, they are permanent outliers inside every galaxy-wide average,
and a metric taken over them is quietly wrong.

The cohort splits cleanly on a fact the game already knows:

- **Physically viable but stuck** — has the deposits and land to feed itself, but cannot break the
  strike loop unaided. Gets a **player-funded intervention**: spend from the treasury to settle the
  strike and restore production, at a cost that is felt. This genuinely interrupts the loop rather
  than masking it, because restored production restores supply, which lowers the shortfall that
  caused the unrest.
- **Physically unviable** — no deposits, no arable land, nothing to build on. Roughly four in five of
  the measured cohort. These worlds should be *allowed to die*: the growth/decline cancellation is
  broken so population actually declines, and the world empties and returns to the map as a
  candidate for later resettlement.

The intervention is deliberately specified as **spending to move goods**, not as spending to remove
unrest. A relief convoy arriving is a thing the player can watch and understand as the cause of the
recovery, which is legibility a purely monetary fix cannot buy — and it uses the logistics simulation
rather than bypassing it. The costing folds into the planned logistics-cost mechanic (labour plus
credits) rather than inventing its own.

## What this does not change

Demand, pricing geometry, the ration threshold, logistics matching, planner capacity sizing and
infrastructure decay are all untouched. `GOOD_NECESSITY` and its weighting keep their current
meaning and values — the weights still decide how much each good's absence counts. The survival-good
floor keeps its current behaviour exactly. `TARGET_COVER` and the cover constants are out of scope.

The unrest integral keeps its shape: relaxation toward a standing floor with the shortfall integrated
on top, and a fixed point of `floor + slope × shortfall`. Only the quantity fed into it changes scale,
and the rate selection stops branching on a label.

## Open questions

- **Does breadth matter?** Worst-good banding means a world short on ten goods at 85% bands as
  Supplied, identically to a flawless one. The supply percentage does capture breadth, so the two
  numbers disagree by design. Whether the band should escalate on breadth is a real choice and should
  be decided deliberately rather than by accident.
- **Are the existing slopes right for the un-squared quantity?** The range coincidence suggests they
  may be close. This must be measured at the equilibrium horizon before any constant is moved.
- **Should worlds be judged against a local expectation rather than an absolute line?** Victoria 3
  compares each population to what *it* expects, derived from its own circumstances, which is why it
  never has to place a universal threshold correctly. A frontier colony and a homeworld arguably
  should not be held to one standard. This is a larger idea than the rest of this document and is
  recorded here rather than designed.
- **Where exactly does the Supplied boundary sit?** ~90% is a starting position, chosen for
  legibility. Once no gameplay reads it, this can be settled by looking at the UI rather than the
  simulator.
