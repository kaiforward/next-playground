---
name: feature-spec
description: Write the functional spec for a feature from its measured evidence — observable behaviour, the hazard worksheet filled with receipts, and what the spec does not claim. Use when the user runs /feature-spec, or when a feature's evidence exists and design is the next step. Refuses to start without evidence.
---

# /feature-spec — behaviour from evidence

**The deliverable is the functional behaviour: what the player and the simulation observably do.**
Brainstorm produced premises, `/measure` produced numbers; this is the first stage that states
mechanics. It is not a plan — no files, no tasks, no code shapes. `/build-plan` owns those.

## Entry condition — refuse without evidence

Open the working file `docs/build-plans/<feature>.md`. Start only if one of these holds:

- an `## Evidence` section exists, carrying `/measure`'s frame (Meaning / Claim / Number / Horizon /
  Cohort / Licenses) for each checkable premise; or
- the `## Idea` section's exit explicitly states the direction has no checkable premises and why —
  an owner-visible claim, quoted here.

Anything else → stop and say which premise is unmeasured. Writing the spec anyway, "to be updated
later", is exactly the skipped-gate this pipeline replaces.

## Steps

### 1. Write the four-field header

The spec opens with four fields, in this order. A missing field is a defect, not a style choice.

```
What changes:  2-4 plain-language sentences — the mechanics as a player or the sim would observe
               them. No math, no field names. (AGENTS.md: specs lead with the headline; math later.)
Why:           the problem from ## Idea, plus every owner decision the spec encodes — each quoted,
               not paraphrased. A decision that isn't in the conversation isn't a decision.
Evidence:      one line per reading this spec rests on — its Meaning and its Licenses line, with a
               pointer into ## Evidence. The Licenses line travels with the conclusion or the
               conclusion doesn't travel.
Not claimed:   what this spec deliberately does not cover, decide, or assert — including the
               plausible reading a skimmer would take away that is wrong. Never empty: a spec with
               nothing excluded has an unstated scope.
```

### 2. State the behaviour, observably

The body describes behaviour a test or a sim metric could check: states, transitions, thresholds
with units, what each surface shows, what happens at the edges (zero, cap, mid-tick, save/load).
Formulas come after the prose that says what they mean. Two sentence disciplines, enforced while
writing because `/spec-review` step 1a will read for them noun by noun:

- **A mechanic sentence** (how the game works today) carries a `file:line`.
- **A requirement sentence** (a quantity the feature will use — a sort measure, a threshold, a
  clears-by) names its producer: an existing `file:line`, or "new — emitted at <where>". A concept
  noun with no producer ("ROI", "severity") is the defect that cost a spec amendment, a plan
  amendment and a mid-build owner question in one feature; do not author one.

### 3. Fill the hazard worksheet with receipts

Copy the worksheet ([shared/design-hazards.md](../shared/design-hazards.md)) into the spec and fill
every in-scope row with the artifact it demands — pasted `npm run impact` output, `file:line`
tables, numbers with horizon + cohort. Scope rule is the worksheet's own: all six rows for anything
touching economy, tick processors, world state or a shared constant; rows 3 and 6 only for pure-UI.
A row filled from memory is assertion, and `/spec-review` treats assertion as unfilled — filling it
honestly here is cheaper than having a lens agent fill it against you.

### 4. Carry the falsifiers with provenance

Move each falsifier's text from the working file **unedited**, with a provenance line
("committed at `<sha>`, moved here unedited") — `/spec-review` diffs the current text against the
first-committed text, and a quietly-tidied falsifier has been caught by that check once already.

### 5. Exit

The spec lands as the working file's `## Spec` section (its own `docs/planned/<feature>.md` only
when the feature is multi-PR and the working file stops being readable — say which and why).
Then one line naming the next stage:

- cross-mechanic surface (two+ processors, or any shared signal/formula/threshold/constant changed)
  → `/spec-review`, mandatory;
- bounded or pure-UI → straight to `/build-plan`, stating that the review is being skipped under
  its own skip rule.

## What this skill does not do

- It does not measure, and it does not soften a reading it dislikes — a spec that needs different
  evidence goes back to `/measure` with a new claim.
- It does not plan: no file lists, no task ordering, no test names.
- It does not tune constants; authored values in the spec are proposals carrying their rationale,
  with defaults set by measurement and definitions set by meaning — never the reverse.
