# Cohorted harness metrics

The simulate report splits its supply readings by **cohort** — which role a market plays for a good,
and what kind of world a system is — instead of reporting one galaxy-wide mean over incomparable
things. A two-pop frontier rock and a developed homeworld stop being averaged into one number.

Two cohort axes, because they describe different things:

- **Market role** is a property of a *market* (system × good): exporter, self-supplier, consumer, or
  inert. One system is simultaneously a fuel exporter and a medicine consumer.
- **World cohort** is a property of a *system*: population band, whether it can feed itself, and
  homeworld vs colony.

This is a dev instrument, not game logic. Nothing in `lib/engine`, `lib/tick`, or world state changes,
and no new per-tick tracking is added — every cohort is derived from the final world at report time.

## Why

Every headline the report prints is a mean or median over **all** systems or **all** markets. That has
produced three wrong readings already:

- `MIN_DEMAND` exists because tiny worlds break the cover arithmetic — a pricing guard now read as a
  logistics deficit signal on every market with no consumer.
- Four in five permanently-struck worlds are deposit-less rocks being judged against a homeworld's
  standard.
- `medianCover` medians over all markets, so cohort *mix* moves it independently of supply.

Each open economy item is a decision taken downstream of one of these measurements, so the instrument
is sharpened before the decisions are made rather than after.

## Cohort definitions

### Market role

Derived by reusing `toGoodMarketStates` (`lib/tick/processors/good-market-state.ts`), already the
single shared definition the directed-logistics matcher and the directed-build planner both read. The
reuse is the point: a market this report labels an exporter is exactly one `surplusDrawable` would
draw from, not a lookalike computed a second way.

The four roles are mutually exclusive and tested **in this order**, because a market can satisfy more
than one description:

| # | Role | Test |
| --- | --- | --- |
| 1 | `exporter` | `production > demand` and not `productionSuppressed` — `surplusDrawable`'s own branch |
| 2 | `self-supplier` | `production > 0`, but does not clear the exporter test |
| 3 | `consumer` | no production, and `demandRate > MIN_DEMAND` (real demand) |
| 4 | `inert` | neither produces nor really demands — the row exists only because `MIN_DEMAND` floored the denominator |

Precedence matters at one specific junction: a mining world producing ore nobody there consumes has a
floored demand *and* real production. It is an **exporter**, not inert — which is the correct and useful
reading, and only the ordering above delivers it. Inert therefore means "no production and no real
demand", a market that is pure pricing-floor artifact.

**Two different demand numbers feed this, and conflating them is the failure this design exists to
prevent:**

- `GoodMarketState.demand` — civilian + industrial from capacity rates, **unfloored**. This is the
  *logistics* demand, and it alone decides exporter status.
- `WorldMarket.demandRate` — the `MIN_DEMAND`-floored **pricing anchor** denominator. This alone
  identifies an inert market (`demandRate <= MIN_DEMAND`).

`MIN_DEMAND`'s docstring says it is "a floor on the cycles-of-supply denominator so a near-empty system
yields a finite cover instead of a divide-by-zero" — a pricing guard. Reading it as demand is how a
market with no consumer came to register as a real deficit. The cohort code uses each number for its
own question only.

### World cohort

Settled systems only (`control === "developed"`); an unclaimed rock has no market and no opinion.

| Cohort | Test |
| --- | --- |
| population band | `<10`, `10–100`, `100–1K`, `>=1K` |
| `survival-short` | `slotCap.arable === 0` — cannot feed itself |
| homeworld / colony | `faction.homeworldId`, the source `summarizeColonisation` already uses |

The population bands straddle where the misreadings happened — a two-pop frontier rock against a
developed homeworld — rather than being round numbers. They are a harness constant and re-cutting them
is a one-line change.

## What the report prints

### Cover and price by market role, per good

One row per good. Answers whether a low galaxy-wide cover means producers are drained flat or consumers
are never served — which the single number cannot distinguish.

```
Good         | Exp n/med | Self n/med | Cons n/med | Cons empty% | Inert n | Exp price×
electronics  |  12/0.25  |   3/0.31   |  190/0.04  |     38%     |    42   |    2.00
```

Column terms, since each is a distinct question:

- `n/med` — market count in that role, and the median cover (`stock / targetStock`) across them.
- `Cons empty%` — share of consumer markets sitting at the stock floor, the existing `nearBandFloor`
  test. Distinct from a low median: a floored market is literally empty, the unambiguous pathology.
- `Inert n` — count only. A median cover over pricing-artifact markets would mean nothing.
- `Exp price×` — median `price / basePrice` across exporter markets. This is the exporter resting-price
  reading: an exporter rests at `EXPORT_RESERVE_COVER` = 0.25×T, below the price-saturation point, so its
  price clamps at the ceiling instead of grading.

### Supply and unrest by world cohort

One row per cohort. Answers whether the unrest band grades anything, or whether the Supplied/Rationing
boundary is being crossed by noise.

```
Cohort         |   n | mean D | unrest | strike% | Sup/Rat/Sho %
10–100 pop     | 210 | 0.31   | 0.44   |   8.1%  | 12 / 55 / 33
survival-short |  91 | 0.52   | 0.71   |  22.0%  |  4 / 40 / 56
homeworld      |   8 | 0.01   | 0.09   |   0.0%  | 98 /  2 /  0
```

A cohort with no members prints `—`, never `NaN`.

## What stays galaxy-wide

The existing aggregates are not wrong numbers — they are correctly computed answers to a question that
is often the wrong one. They keep their current definitions so every figure already measured against
them stays quotable, and each has one stated job:

| Metric | Disposition |
| --- | --- |
| price levels (median, p10, cheap/near/expensive) | **Keep.** `TARGET_COVER` is authored as the whole-roster knob for cross-system price *dispersion*; dispersion across the whole galaxy is what this measures. Cohorting it would destroy the measurement. |
| population totals, growth %, infrastructure decay | **Keep.** Sums, not means — immune to the mix problem. |
| `medianCover` per good | **Annotate** with the inert share, so mix is visible at the point of reading. |
| `meanUnrest`, `meanDissatisfaction` | **Annotate** with a pointer to the world-cohort table. |

Nothing is deleted, and no follow-up cleanup pass is scheduled. A report that prints both a mix-dependent
mean and its cohorts, with nothing saying which to read, is how the misreading happens again — so the
annotation is part of this work, not a later tidy-up.

## Scope

**Age since founding is deliberately not a cohort axis.** Only colonies founded *during a run* have a
`foundedTick`; `TickSystem` carries no such field, so every world-gen system would land in one
undifferentiated bucket, and at the equilibrium horizon that is most of the galaxy. `foundingStock`
already reports opening satisfaction for exactly the in-run cohort, which is the age question that had a
customer. Population band proxies "young colony still filling" well enough, since young colonies are
small — a known limit, not an oversight.

Out of scope: any change to gameplay constants, to world state, or to the tick. This is measurement
only; the decisions it informs are separate work.

## Testing

Vitest unit tests on the classifiers against hand-built rows:

- exporter / self-supplier / consumer boundaries, including the `productionSuppressed` case
- `MIN_DEMAND` floor detection — the distinction the whole design rests on
- empty cohort renders `—`, never `NaN`; medians and means over zero members are a live divide-by-zero
  risk and `NaN` must not reach serialized output

**Acceptance is not "the tests pass".** The instrument has to decompose the two open questions when run
at both horizons: fuel's 0.79 → 0.61 regression resolves to a role, and electronics' 0.25 resolves to
producers-drained versus consumers-unserved. If it cannot distinguish those, it has not done its job.

## Lifecycle

This doc is deleted when the work ships — the harness's description lives in `AGENTS.md` and the module
docstrings, and the code is the source of truth.
