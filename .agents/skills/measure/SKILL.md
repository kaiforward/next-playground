---
name: measure
description: Produce concrete evidence about how the game actually behaves, before any design is written. Use when the user runs /measure, or whenever a claim about current behaviour is about to be built on — including a claim that something has been ruled out.
---

# /measure — evidence before design

**Evidence is the deliverable.** No spec, plan or options list comes out of this skill — a number does,
with the conditions it was taken under attached.

This exists because the failure that keeps costing us whole PRs is asserting on a premise nobody
measured. The worst instance had *correct arithmetic*: phantom `MIN_DEMAND` demand was measured at
0.3% of deliveries, declared ruled out, and steered a whole investigation away from its own cause.
Re-measured at the other horizon it was 24.7% of all delivered cargo.

Run this when anything downstream will rest on a claim about how the game behaves today. **A "ruled
out" is such a claim** and gets the same treatment — nobody re-tests a negative, so a wrong one
survives indefinitely.

**Read `docs/active/engineering/measurement-traps.md` before trusting any measurement** — every way
a reading of this simulation has produced a confident, specific, wrong answer.

## Steps

Do these in order. Steps 1-2 happen **before** any instrument runs, and that ordering is the point.

### 1. State the claim

One sentence, about current behaviour, falsifiable. Not "luxuries logistics feels broken" but
"luxuries consumer markets sit below 0.3 median cover at equilibrium".

If you cannot write it as a sentence that could be wrong, you are not ready to measure — go back
to `/brainstorm`.

### 2. Write the falsifier, then commit it

**Before running anything**, write what result would kill the claim:

> Falsifier: if luxuries consumer cover reads above 0.6 at **both** horizons, the claim is false and
> the idea that rests on it goes back to brainstorm.

Then `git commit` it into the working file. This is not ceremony — a falsifier written after the
number exists is not a falsifier, and committing it first makes any later edit show up in `git diff`.
Nobody can audit an intention; they can audit a diff.

State the falsifier in the same units and at the same horizon you intend to measure. "If it looks
fine" is not a falsifier.

### 3. Choose the instrument

The wrong instrument is the second most common failure here, and it produces confident numbers.

| The question | Instrument |
|---|---|
| A level, rate or distribution across the galaxy | `npm run simulate` — read **both** horizons, cohorted |
| Whether a mechanism fires at all, and how often | scratch diagnostic **inside** the processor, counting |
| Where a quantity goes, or who consumed it | instrument at the point of use, **inside the tick** |
| Who reads a constant, field or signal | `npm run impact -- <SYMBOL>` |
| Whether a signal exists and what range it has | `npm run impact` to find the producer, then read it |
| Whether a pure function is correct | Vitest — **and it proves nothing about galaxy behaviour** |

**The anti-instrument:** an isolated engine fixture. Fixtures pass while the galaxy is 100% broken.
If the claim is about outcomes, the simulator measuring the actual outcome is the only evidence.

**Before authoring any instrument, spend an `npm run impact -- <SYMBOL>` on the quantity** — who
writes it, who reads it, where it sits in the run order. The expensive loop in this skill is
Inconclusive → back here → re-instrument → re-run; most wrong-instrument picks (wrong function,
wrong scope, measured outside the tick) are visible in that one cheap read.

Scratch diagnostics live in `temp/` (gitignored) and are never committed. `lock-diag.ts`
(anchor funding, per-producer stock) and `floor-diag.ts` (per-good floored share, requested vs
delivered at the moment of transfer) already exist and take `DIAG_TICKS`/`DIAG_SYSTEMS`/`DIAG_SEED`.

### 4. Run it, validate it, record the raw output

**Validate the instrument before you read it.** Find a quantity the tick already records independently
and check the two agree — `flowEvents` has exactly one writer (directed-logistics), so an attributed
haul count must equal it. A zero is the case that most needs this: a counter that never fires and a
mechanism that never fires look identical, and only a second signal tells you which one you have.

Then paste the actual output into the working file. Not your summary of it — the output. A summary is
where the horizon and the cohort quietly fall off.

A full `npm run simulate` report is large and mostly not about your claim. Run it in the background
and grep out only the rows the claim names — the good, the cohort, both horizons — rather than
reading the whole report into context. "The actual output" means those raw rows verbatim, horizon
and cohort labels intact; it does not mean the full dump.

**Then revert your instrumentation, in the same turn.** Counting "inside the processor" means editing
tracked code under `lib/`. That patch is a measuring tool, not a change, and it must never reach a
commit: `git checkout -- <file>`, then `git status` and a grep for the hook's name across `lib/` and
`scripts/`. Do this before writing up, not after — the write-up is where it gets forgotten. Only the
scratch runner in `temp/` (gitignored) survives the session.

### 5. Report in the required frame

Every reading gets all six, `Meaning` first. A missing field is a defect, not a formatting choice.

```
Meaning:    one plain-language sentence — what was found, in functional terms, no numbers
Claim:      <the sentence from step 1>
Number:     <the reading>
Horizon:    startup (1000t) AND equilibrium (10,000t) — both, or say why one is enough
Cohort:     which population this was read over (market role, world cohort, faction…)
Licenses:   what this number does and does NOT support
```

`Meaning` leads because a reader who stops after one line must still leave with the finding — the
numbers are the reference, not the message.

**The `Licenses` line is the one that was missing when this went wrong.** Every figure in the ruled-out
note was accurate; the inference from them was not. A startup fault can set the equilibrium level, so
"it is only 0.3% of flow now" is not evidence it did not cause the state you are standing in.

### 6. Compare against the falsifier — three outcomes, not two

- **Confirmed** — the claim survived. Proceed to `/feature-spec`. Carry the whole Evidence block over.
- **Falsified** — back to `/brainstorm`. This is a success. It cost one measurement instead of a PR.
- **Inconclusive** — the instrument could not answer the question. Go back to **step 3 and pick a
  different instrument.** Do not reinterpret the number you have until it agrees with you; that is
  the failure this skill exists to prevent, and it looks exactly like progress.

## Traps — check every one before believing a reading

Each cost a real investigation here.

- **Never measure the tick's internals from outside the tick.** Logistics runs near the end of a tick,
  after economy/decay/population/migration moved stock and demand, and before build and founding move
  them again. A pre-tick snapshot claimed 84% of deliveries "exceeded" their target — pure artefact.
  Instrument inside the processor.
- **`anchorMult` especially.** Events applies anchor shifts *during* the tick (it runs 2nd of 9).
  Reading it beforehand gave "events explain 8%"; reading it where the matcher reads it gave 100%.
- **Read aggregates cohorted.** A galaxy-wide median moves with cohort **mix**, not only with the
  thing it measures — `fuel` cover "regressing" 0.85 → 0.61 was entirely the exporter cohort growing
  23 → 220 markets, each resting at 0.25 by design, while consumers improved.
- **The startup transient is ~300+ cycles** (`CYCLE_LENGTH` 24). A short read is never evidence of an
  equilibrium fault; an equilibrium read is never evidence that a founding fault does not exist.
- **Striking count is churn, not health.** 50 systems striking in one frame was 26 chronic cases and
  30 crossing the line in both directions. Judge over a trailing window.
- **Suspect the instrument before the thing it measures.** The harness once ran at `ECONOMY_SCALE=1`
  while the game ran at 100 — same seed, same code, a dying galaxy in the sim and a thriving one in
  the game. Hours went into phantom problems.
- **Measure with the function the mechanism actually calls, and check its scope.** Using the build
  planner's `spare` instead of logistics' `surplusDrawable`, while missing that `matchFactionTransfers`
  runs per faction, turned "22 of 23 have no supplier" into a confident "0 of 23".

Fuller list: `docs/active/engineering/measurement-traps.md`.

## Output

Everything goes in the feature's working file, `docs/build-plans/<feature>.md`: an `## Evidence`
section with the five-field frame from step 5 plus the raw output.

**If there is no working file yet — a standalone question, e.g. a roadmap row — create one.** That is
the file step 2's claim and falsifier are committed into, before the instrument runs, and the file the
later spec or build plan continues. It is transient like any build plan: deleted when the item ships,
after carrying anything durable into the active doc or the `killed-designs` memory.

**Never write the evidence into `docs/ROADMAP.md`.** The roadmap's own header says measurements belong
in the linked doc, and a row is *what it is / next step / Don't* — three lines, not an appendix. The
row gets one pointer line and, if the reading changed the item, a corrected next step. A 130-line
evidence block in the queue is how the queue stops being readable.

Then say, in one line, which of the three outcomes it was and what happens next.

## What this skill does not do

- It does not propose a design, a fix, or options. If the evidence suggests a direction, say so in a
  sentence and stop — `/feature-spec` owns the design.
- It does not tune anything. A constant changed to make a number look better, before the mechanism is
  understood, is how we got a `HOLD_COVER` that silently caps below `SURPLUS_MARGIN`.
