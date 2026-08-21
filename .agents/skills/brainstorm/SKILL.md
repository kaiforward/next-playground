---
name: brainstorm
description: Shape a feature or mechanic idea into one chosen direction with stated premises and a committed falsifier, ready for /measure. Use when the user runs /brainstorm, or when a roadmap item or new idea is about to be designed and no evidence or spec exists yet.
---

# /brainstorm — shape the idea, surface the premises, stop

**The deliverable is a chosen direction plus the premises it stands on — not a design.** The skill
ends at `/measure`'s doorstep: a working file with an `## Idea` section and a committed falsifier.
No spec, no plan, no code, no tuning.

This exists because the expensive failure is designing on an unstated premise. The mechanism that
prevents it is not thinking harder — it is writing the premises down where the next stage is forced
to check them.

## Ground rules

- **Prose only. Never a forced-choice list.** Options are presented as plain text with a stated
  recommendation; the owner replies in their own words. No `AskUserQuestion`, no numbered menus that
  railroad toward a pick. One decision at a time; wait for the call before raising the next.
- **Claims about current behaviour carry a receipt or a hypothesis label.** A `file:line`, a number
  with horizon+cohort, or the explicit tag *(hypothesis)*. Inference written in the voice of fact is
  the failure this pipeline exists to stop — it applies to the brainstorm too.
- **External references are definitional, internal readings are not.** "Vicky3 runs 4 ticks/day" can
  anchor a definition; "our worlds fill by tick 12K" can only be a premise to verify. A rate can fail
  a definition, never set it (AGENTS.md → Working Practices).

## Steps

### 1. State the problem in the owner's terms

One short paragraph: what feels wrong or missing, in plain language, before any solution. If the
problem statement already contains a solution ("we need a warehouse building"), split it — the
solution goes to step 3 as one candidate among others.

### 2. Sweep the shipped mechanics the idea would touch

Walk the fixed system list from the hazard worksheet
([shared/design-hazards.md](../shared/design-hazards.md) → hazard 3) at brainstorm depth: one line
per system — *touches / probably touches / no, because…*. **Events is the recurring miss; it gets a
written line every time, never a mental check.** The full worksheet with evidence comes later at the
spec; here the sweep's job is to change the option list — an idea that dies on contact with staffing
or decay should die now, before anything is measured for it.

`npm run impact -- <SYMBOL>` is cheap and allowed here for any quantity the idea would move; a
five-line read now beats discovering a second reader at spec review.

### 3. Lay out directions, recommend one, wait

Plain prose: each candidate direction in a sentence or two, with what it costs and what it couples
to (from step 2). State a recommendation and why. Then stop and let the owner call it — including
calling something not listed. Killed directions worth remembering (rejected for a reason that will
recur) go to the `killed-designs` memory, one line each, when the session ends.

### 4. Write the premises the chosen direction stands on

The core artifact. List every claim the direction assumes, each classified:

- **checkable** — about current behaviour; becomes a `/measure` claim. Write it as a falsifiable
  sentence in `/measure`'s step-1 form.
- **definitional** — an owner decision or external anchor; needs no measurement, just the owner's
  explicit yes (which the conversation should already contain — quote it).
- **hypothesis** — believed, not yet checkable cheaply; carried forward with the label on.

An idea with zero checkable premises is either trivially small or badly stated — say which.

### 5. Commit the falsifier

Create the working file `docs/build-plans/<feature>.md` with an `## Idea` section: the problem
statement, the chosen direction, the killed alternatives with one-line reasons, the premise list
from step 4, and — last — the terminal falsifier: **the measurement result that would kill the whole
direction**, in the units and at the horizon `/measure` will read.

Then `git commit` the file, before any instrument runs. A falsifier written after the number exists
is not a falsifier; committing first turns a later edit into a visible diff (mechanism A,
`docs/active/engineering/feature-process.md` → Ranks of guarantee).

## Exit

One line: the chosen direction, and the first checkable premise `/measure` takes next. If the
direction has no checkable premises, exit to `/feature-spec` instead and say why the evidence stage
is being skipped — that is an owner-visible claim, not a default.

## What this skill does not do

- It does not measure. Numbers quoted here are premises for `/measure`, not findings.
- It does not produce a spec, options table, or plan — `/feature-spec` starts from the evidence.
- It does not tune constants "to try it". Nothing in the tree changes except the working file.
