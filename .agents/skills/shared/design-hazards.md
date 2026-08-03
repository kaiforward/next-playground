# Design hazards — the worksheet

The recurring ways a design for **this** game has been wrong. Every hazard here has shipped at least
once; the instances are named so you can recognise the shape, not to be read as history.

**This is a worksheet, not a warning list.** Each hazard says what you must *produce*. A hazard with
nothing filled in is a hazard you skipped — that is the point of the format. Answering "considered, no
issue" without the artifact is the same as not doing it.

Fill it at **Design** (the functional spec carries the filled rows) and check it at **Spec Review**
(the reviewer's first job is to verify each row is filled with evidence, not assertion). Reaching
implementation with an unfilled row is a process failure, not a style problem.

Scope: fill every row for any change touching the economy, the tick processors, world state, or a
shared constant. A pure-UI or tooling change fills rows 3 and 6 only.

---

## 1. One quantity, several unrelated jobs

**The single most repeated defect in this project.** A number authored for one purpose acquires
readers in unrelated systems, and then nobody can change it for one without moving the others.

Shipped instances:
- `TARGET_COVER` — price anchor **+** fill target **+** logistics deficit line **+** production throttle knee.
- `MIN_DEMAND` — a divide-by-zero guard for *pricing*, which became the real deficit signal on every
  market with no consumer. Cost a full investigation and a PR (#211).
- `demandRate` — the unit of account: price anchor, market band, ration threshold, glut/decay signal,
  logistics deficit gate, planner capacity sizing, colony founding stock, and the harness cover metric.
- `surplusDrawable` — one denominator serving the logistics donor, the build input-supply gate, and the
  colony founding manifest. Still unresolved.
- `HOLD_COVER` (1.3) silently capping below `SURPLUS_MARGIN` (1.4) — landed three days apart in
  unrelated features, neither aware of the other.

**Produce:** for every quantity your design reads or writes, the complete list of its existing readers,
from a grep — not from memory.

| Quantity | Every reader today (`file:line`) | Which of them this design moves | Is that intended? |
|---|---|---|---|

If a quantity has more than one reader in more than one system, the design must say explicitly whether
it is separating them or deliberately keeping them coupled. "I only need it for X" is how this defect
is created every time.

## 2. A constant read for a meaning it was not authored to have

**Read the docstring, not the value.** The tell has been in the docstring every time.

Shipped instances:
- `GOOD_CONSUMPTION` says "higher tier → lower need… only their relative shape matters" — a tier
  gradient, **not** a necessity ranking (medicine 0.001 sits below gas 0.004 purely by tier). A spec
  read it as necessity and got the fold backwards.
- `priceFloor`/`priceCeiling` — a pure tier lookup, zero per-good variation.
- `volatility` — authored for trade flavour, read by nothing.

**Produce:** for every constant your design leans on, its docstring quoted, and one line on whether the
authored intent matches the use you are making of it.

| Constant | Docstring says it means | This design uses it as | Same thing? |
|---|---|---|---|

Also check the table's real shape — how many entries, what actually varies — rather than a hand-picked
subset. Three of the instances above look like they mean the right thing until you read the whole table.

## 3. A system you did not think about

**Events is the recurring miss.** The list below is fixed: state the interaction or state "none" *with
a reason*. A row you cannot fill is a system you have not thought about yet.

**Produce:** every row, with a reason — never a bare "n/a".

| System | Interaction with this change | Reason if none |
|---|---|---|
| Events | | |
| Population + migration | | |
| Unrest / regime | | |
| Industry + staffing | | |
| Infrastructure decay | | |
| Directed logistics | | |
| Directed build / planner | | |
| Colonisation + founding manifest | | |
| Treasury / purse | | |
| Factions + relations | | |
| Save format (`World` shape) | | |
| The harness's own metrics | | |

Precedent for why decay and staffing are on the list: a plan that ignored staffing built unstaffable
capacity that decay then ate.

## 4. A symptom asserted without a measurement — or with the wrong one

Shipped instances:
- Phantom `MIN_DEMAND` demand "RULED OUT" on a 416-cycle read (0.3% of deliveries). At 42 cycles it was
  **24.7% of all delivered cargo** and it was the cause. Every figure was accurate; the *inference* was
  wrong, because a startup fault can set the equilibrium level.
- "`colony_establish` seeds no market stock, **so** every colony is born at satisfaction 0" — a true
  code fact plus an unverified inference, sitting in a plan beside two claims that carried citations
  and read exactly like them.

**Produce:** every claim about how the game currently behaves carries either a `file:line` or a number.
Every number carries **the horizon and the cohort it was measured at**.

| Claim | Evidence (`file:line` or number) | Horizon | Cohort |
|---|---|---|---|

A claim with no evidence column filled is a hypothesis. Label it as one in the spec, or measure it.
**A "ruled out" is a claim and needs the same bar** — nobody re-tests a negative, so a wrong one steers
every later investigation away from the cause.

## 5. Designing against a threshold, signal or primitive that does not exist

**Interaction specs are not integration proof.** Verify the foundation actually exposes the discrete
thing your design reads.

Shipped instance: a whole roadmap item, "re-cut the unrest band", was written against a
Supplied/Rationing threshold. `foldSupplyState` returns `rationing` for **any** `d > 0` and `supplied`
only at exactly 0 — there is no threshold to re-cut, because there is no threshold. Built as specified,
it would have done nothing.

**Produce:** for each signal, threshold, field or primitive your design consumes, the `file:line` where
it is produced today, and its actual range or shape.

| Consumes | Produced at (`file:line`) | Actual shape / range today | Design assumes |
|---|---|---|---|

## 6. Designing against an aggregate that moves for other reasons

A galaxy-wide mean or median moves with **cohort mix**, not only with the thing it measures.

Shipped instance: `fuel`'s median cover "regressing" 0.85 → 0.61 between horizons was entirely the
exporter cohort growing 23 → 220 markets, each resting at 0.25 *by design*, while the consumers they
serve improved (22% → 10% empty). Nothing had got worse.

**Produce:** for every metric your design targets or claims to improve, the cohort breakdown it will be
read at, and what else could move it. `npm run simulate` splits by market role and world cohort — use it.

| Metric | Read at which cohort | What else moves this number |
|---|---|---|

---

## The command that fills rows 1, 3 and 5

```
npm run impact -- <SYMBOL>          # every reader, grouped by module
npm run impact -- <SYMBOL> --quiet  # counts and ripple only
```

For each quantity, field or signal your design touches, run it and **paste the output into the
worksheet**. It reports:

- every module that references the symbol, across the tick, the read paths outside it, and the harness
- which tick processors declare it as a **read**, and their position in the run order
- which processors touch it *without* declaring it — i.e. probably **write** it (this is how events
  shows up; it derives `anchorMult` and declares none of it, which is exactly why it gets forgotten)
- whether the symbol is shared widely enough that hazard 1 applies

Two things it does **not** do, so don't read more into a clean result than is there:

- It counts modules, not call sites, and a symbol in two modules already reads as `CONTAINED`. Two
  readers in two systems is where this defect starts — the verdict is a prompt, not a ruling.
- It is a text search over tracked files. It cannot see coupling that runs through a differently-named
  intermediate, so it complements reading the code rather than replacing it.

Hazard 5's "does this signal exist and what shape is it" still needs you to open the file the command
points at. The command finds the producer; only reading it tells you the range.
