---
name: build-plan
description: Turn a reviewed functional spec into an implementation plan — files, task order and the interfaces between tasks, explicitly not the code. Use when the user runs /build-plan, or when a spec has been approved (and spec-reviewed where cross-mechanic) and implementation is about to start.
---

# /build-plan — files, order, interfaces. Not the code.

A build plan is the smallest artifact two sessions could build adjacent parts of a feature from
without talking to each other: which files, in what order, and the contracts between tasks. The code
is written at implementation, against the spec — a plan that contains the code is the implementation,
done early, outside review.

**Entry condition: the spec exists.** The feature's working file (`docs/build-plans/<feature>.md`)
carries `## Spec`, or a spec doc in `docs/planned/` is named. If the spec has cross-mechanic surface
(the `/spec-review` when-to-run test) and there is no record of that review having run, stop and say
so — planning around a missed gate builds the gate's failure into the task list. No spec at all →
that is the `/feature-spec` stage of the sequence; go back and write one, hazard worksheet filled.

## What a task is

The plan is an ordered list of tasks. Every task carries all four fields — a missing field is a
defect, not a formatting choice:

```
### Task N — <one-sentence goal>
Files:      <every file touched; existing files verified present, new files marked (new)>
Interface:  <the signatures, types and fields this task exposes — the contract later tasks consume>
Proves:     <the test or sim metric that FAILS if this task's premise breaks — not the happy path>
Consumes:   <which earlier tasks' interfaces it reads; never one a later task defines>
```

The `Interface` field is the plan's actual content. "Add the donor gate" plans nothing;
"`donorDrawable(market, good): number`, replacing the `surplusDrawable` read in
`matchFactionTransfers`" is a contract one session can build and another can build against.

Phases are check-in pauses on one branch, never PRs — `AGENTS.md` owns the PR unit.

## Plan-level fields

After the tasks, three sections, all required:

**Verification** — how the finished feature is proven in the galaxy, not in fixtures: which sim
metric moves, read at **both horizons**, cohorted; the build gate (`npx next build --webpack`); and
any new harness metric needed because the symptom would otherwise hide inside an aggregate.

**Doc fold** — which active docs this feature makes stale, which planned docs it supersedes, and the
note that this working file is deleted at ship. The fold happens on the branch, before the final
review. Seven of fourteen planned docs rotted because this was left to "later".

**Not covered** — the negative statement, in the same breath as the plan. What the plan deliberately
leaves out, and for each item: **booked** (a roadmap row, named) or **dropped** (a reason, written).
An exclusion with neither is a finding against the plan. The field is attached to finishing the plan
because producing text beats doing the check — this way the check is the text.

## Self-review — the final step, not a second gate

Minutes, by the author, before committing the plan. No agent dispatch.

- **Every named identifier, grep-verified.** Each existing file, function, constant or field the plan
  references exists (`grep` / `npm run impact`); each `(new)` name does not already exist. A plan
  naming things that aren't there is hazard 5 at plan level — a whole roadmap item was once written
  against a threshold that did not exist.
- **Nothing dropped between spec and plan.** Every interaction row and accepted amendment in the spec
  lands in some task. The difference between spec scope and plan scope is either empty or listed in
  **Not covered**.
- **No code.** A task containing a function body, an `if`, or a derived formula is implementing —
  move the decision into the spec or cut it. Signatures and types are the ceiling.
- **Shared quantities stay inside the spec's evidence.** A task touching a symbol the spec's row-1
  table never analysed is not a planning detail; it is missed spec scope. Go back.

Fix what the self-review finds, note anything material in the plan, move on. It is a checklist, not
a review cycle.

## Output

`## Build plan` appended to the working file and committed. The file stays the feature's single
working file (`## Idea → ## Evidence → ## Spec → ## Build plan`) and is deleted when the feature
ships, after the Doc fold runs.

## What this skill does not do

- It does not write code, name branches of logic, or derive formulas — the spec owns decisions, the
  implementation owns code.
- It does not re-design. A hole found while planning goes back to `/spec-review` (missed scope) or
  the spec itself (wrong mechanism) — patching it inline is how a plan and its spec end up
  describing two different features.
- It does not tune constants or promise numbers the spec's evidence doesn't license.
