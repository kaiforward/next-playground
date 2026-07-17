# Processor Interval Awareness — Handover

Status: **Problem stated, not yet designed.** Written 2026-07-17 at the end of the session that
killed the construction-cadence slice. Next step is a design pass, then a plan.

This doc exists so the next session starts from the findings rather than re-deriving them. It is
transient — it becomes the design + plan and is deleted when the work ships.

---

## 1. The problem

**Cadence is not a knob, and it looks like one.** `MONTH_LENGTH` / `ECONOMY_UPDATE_INTERVAL` read as
tunable constants. They are not. Change 24 to anything else and two processors compensate correctly
while four silently change their wall-clock rate.

`catchUpFactor(interval) = interval / REFERENCE_INTERVAL` (`lib/tick/shard.ts:52`) is the established
pattern, and its own doc comment states the intent:

> Rate multiplier so a sharded processor applies "elapsed-ticks worth" per run… At the reference
> interval it is 1 (calibrated magnitudes unchanged); tuning the interval changes only granularity,
> not the wall-clock rate.

That intent is only half-implemented. Consumers of `catchUpFactor`, verified by grep:

| processor | interval-aware? | what happens at interval 10 instead of 24 |
|---|---|---|
| `economy.ts` | **yes** | correct — applies 0.42× per run, same rate per tick |
| `migration.ts` | **yes** | correct |
| `population.ts` | **no** | pop growth runs 2.4× more often at full magnitude → **2.4× faster** |
| `infrastructure-decay.ts` | **no** | decay 2.4× faster — and see §3, `idleMonths` is worse than a scale bug |
| `directed-build.ts` | **no** | takes `interval`, uses it only for `pulseShard`'s cadence, never for magnitude → 2.4× more construction per game-year |
| `directed-logistics.ts` | **no** | same shape as directed-build → 2.4× more transfers |

So the interval is a **performance knob that silently moves gameplay rules** — the exact hazard
CLAUDE.md names ("Keep gameplay and performance concerns separate — never let a performance mechanism
silently become a gameplay rule").

## 2. Why this is the right shape of work

Fix the scaling and cadence becomes a free knob afterwards. That ordering matters: the slice we just
killed would have hard-coded one processor's cadence as a special case, making the knob *harder* to
fit later.

**Vic3 is the reference model and we already mirror it.** Its base tick is 6 hours (4/day), and it
explicitly divides work into *tick categories* — yearly, monthly, weekly, daily, regular — because
"some work might not need to happen as often as others" (Paradox's own Performance dev diary). Its
economy resolves weekly = every ~28 base ticks. Ours resolves monthly = every 24. **Same
architecture, near-identical ratio.**

The unit is arbitrary and ours to define — this is sci-fi, a "week" is whatever we say. What matters
is the **ratio**: units move on the fine tick because players expect responsiveness; the economy
resolves on a macro tick precisely because players do not expect a society to turn on a dime. Vic3's
structure is the lesson, not its numbers.

## 3. The known hard parts

- **`infrastructure-decay.ts`'s `idleMonths` is a COUNTER, not a rate.** It counts pulses, so it does
  not scale. Halve the interval and "three months idle" silently becomes 1.5 months of game time. It
  needs to count ticks, or have its buffer scaled by the interval. This one needs a think, not a
  multiplier — it is the only member of the set that is not mechanical.
- **`directed-build`'s `PER_BUILD_ABSORPTION_CAP` is the minimum-build-time mechanic**
  (`lib/constants/construction.ts:22`: a level's minimum build time is `workCostPerLevel ÷ cap`
  pulses). It must scale *with* the pool, or changing the interval changes how many parallel fronts a
  faction runs — a gameplay rule moving because someone turned a performance knob.
- **`REFERENCE_INTERVAL` is the calibration anchor** (`tick-cadence.ts:2`). It is 24 because that is
  what the economy was tuned at. It should stay 24 through this work; the point is to make *other*
  intervals correct, not to re-tune the reference.

## 4. Do NOT re-base the tick as part of this

Tempting (Vic3's 6-hour tick; armies will eventually want sub-day resolution) and explicitly deferred.
Making the base tick ~6× finer multiplies the cost of everything that runs every tick, and post-#180
that is events (67.5%) + `toTickSystems` (19%) ≈ 87% of an off-pulse tick. It would hand back #180's
−38.1% several times over, to buy resolution nothing currently needs — there are no armies, and ships
already move every tick.

Interval-awareness makes re-basing cheap *whenever* we want it. Do the knob now; turn it later; re-base
only when something concrete needs sub-day resolution.

## 5. Why the construction-cadence slice was killed

Recorded so nobody re-proposes it from the same premises. It planned to split construction's decision
cadence (monthly) from its execution cadence (per-tick). Design and an 8-task plan were written; the
plan was never built. Two independent failures, both verified against the code, not inferred:

1. **The neutrality claim was false.** Design §4 argued per-tick funding was simulation-neutral. The
   economy processor runs *before* directed-build in the same tick (`tick.ts:568` vs `:809`), so today
   a building landing on a boundary is invisible to that boundary's economy and waits a full month.
   Per-tick landing removes that lag — a real economic acceleration of up to a month, for every
   project whose work is not an exact multiple of the absorption cap.
2. **The slicing equivalence was false in EXACT arithmetic** — not floating point, which was the
   suspected risk. Verified by running the real `fundQueueWithFloor` against itself:

   ```
   contended, no landing        lump  A=4.00 B=1.00 C=0.00
                                sliced A=4.00 B=1.00 C=0.00   ← identical
   contended, A lands mid-cycle lump  B=4.00 C=0.00
                                sliced B=3.25 C=0.75          ← divergent, never re-converges
   ```

   Cause: `fundQueueWithFloor` is homogeneous in `(pool, cap, reserved)` *except* the
   `remaining = workTotal − workDone` term, which does not scale. Equivalence holds while the queue is
   stable and breaks the moment a project lands mid-cycle — which is the feature's entire point. Under
   the lump a freed front's capacity is re-absorbed by the next build up to the full cap; sliced, that
   build is already at its per-tick maximum, so the surplus cascades further down the queue. Totals are
   conserved; the distribution shifts down, permanently.

**But the deciding argument was neither of those — it was that the motivations did not survive.**
Design §1 justified the work by a queue-timing "exploit" (queue at tick 23, get a month's work one
tick later; queue at 25 and wait a month) and by dead progress bars. Both are standard Paradox cadence
artifacts:

- Vic3 has the same exploit. Construction points land Monday; queue Sunday and wait a day, queue
  Tuesday and wait six. Its window is ~28 base ticks — *larger* than our 24. Nobody calls it an
  exploit, because under a monthly-accounting fiction it isn't one: it is a budget cycle. Miss the
  allocation, wait for the next. That has perfectly good fictional meaning.
- Vic3's construction bars also only move once per weekly tick. Freeze-and-jump is what it ships.

And per-tick funding would have made construction **the only system running finer than the economy** —
the one thing that genuinely *would* be inconsistent with the architecture we are modelling.

**If per-tick construction is ever revisited, it needs a new justification** ("we are not Vic3, smooth
bars are worth an economic change"), not the neutrality argument, which does not hold.

## 6. Findings worth keeping regardless

- **The economy reads building counts before directed-build lands them** (`tick.ts:568` vs `:809`), so
  a building completing on the boundary waits a full month to be economically recognised. This is an
  artifact of processor ordering, not a designed lag. It is *not* the same as the deliberate
  demand-anchor lag (which is booked and intended). Nobody has decided this one is correct — it just
  is. Worth a look whenever processor order is next on the table.
- **`popCap` rises ONLY at `tick.ts:348`** (`Math.max(s.popCap, housingPopCap(buildings))`, inside
  `applyBuildingIncreases`, gated on housing being among the landed types), and infrastructure decay is
  downward-only and will not repair it. Any refactor that lands housing by another path welds a
  colony's cap to its seed level permanently — silently, with nothing failing. Booked in BACKLOG as a
  missing test.

## 7. Open questions for the design session

1. Is `catchUpFactor` the right abstraction for all four, or do rates and counters want different
   treatment? (`idleMonths` says at least two shapes exist.)
2. Should each processor own its interval constant, or should there be one cadence table? Today
   `DIRECTED_BUILD.INTERVAL`, `DIRECTED_LOGISTICS.INTERVAL` and `ECONOMY_UPDATE_INTERVAL` are declared
   separately and all alias 24 — #180's review already caught one bug from binding the wrong one
   (`lib/world/tick.ts:618-625`).
3. What is the validation gate? Per CLAUDE.md, economy changes are verified by intrinsic coherence,
   not parity — but interval-invariance has a *stronger* available gate: running at interval 12 and
   interval 24 should produce the same wall-clock rates. That is a real property to test, and it is
   what "the knob works" means.
4. Does anything else in the tick assume 24 implicitly? (Events phases, `EVENT_SPAWN_INTERVAL`,
   `RELATIONS_FREQUENCY = 3`, flow retention windows.)
