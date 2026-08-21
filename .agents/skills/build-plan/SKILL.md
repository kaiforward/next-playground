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
Proves:     <detection list — the 3-6 wrong behaviours this task's tests must be SEEN to fail on:
             boundaries, contention paths, branch arms, the vacuity check. Behaviours in words,
             never test code. Not the happy path.>
Consumes:   <which earlier tasks' interfaces it reads; never one a later task defines>
```

A task that touches UI carries a fifth:

```
Reuse:      <the existing components/ui|form pieces, hooks and helpers this task composes, each
             verified by reading its props — or "New: <name> — nothing fits because <reason>">
```

**`Reuse` is where duplication is prevented — at the source, not at review.** The survey AGENTS.md
requires before building any component happens here, once per feature against the real files,
instead of once per implementer, chunk-scoped and alone — the copy an implementer cannot see is the
one that gets rewritten. Each named component is verified by **reading its props**, not remembered.
A task that finds nothing to compose writes `New: <name>` with the reason — and the search that
failed is run in the words a *user* of the behaviour would type, because the name-is-the-bug rule
cuts both ways: search for what it does, and name the new thing for what it does. `npm run
duplication` at review is the backstop, never the plan.

**`Files` is a floor, not a contract.** The implementer reports in the ledger any file touched
beyond the list and any listed file that turned out to need no change; neither is a defect, both are
recorded. An implementer treating the list as exhaustive under-delivers; one treating it as a
ceiling over-delivers — the floor semantic is the contract, so neither reading is left to guess.

The `Interface` field is the plan's actual content. "Add the donor gate" plans nothing;
"`donorDrawable(market, good): number`, replacing the `surplusDrawable` read in
`matchFactionTransfers`" is a contract one session can build and another can build against.

`Proves` is a **detection list**, not a single premise. Each entry names one behaviour that would be
true if the task were built wrong — a boundary that doesn't hold, a contention path that loses, a
branch arm that never fires, a test that passes against an empty implementation (the vacuity check).
At implementation the red-proof gate executes this list item by item: break the listed behaviour,
watch the named test fail, restore. A task that pins one premise leaves every other behaviour
unpinned. The list is 3-6 entries: fewer means the task's failure modes weren't enumerated; more
means the task is too big.

Entries are behaviours in words — "a donor at exactly its reserve gives nothing", never test code
or assertions. The no-code rule holds in this field like every other.

`Proves` must be runnable at the task's own position in the order — a sim metric a later harness
task builds belongs to that stage's gate, not to an earlier task's `Proves`.

## Resolution — every measure gets a producer, before any task is written

The first pass over the spec is not task decomposition. It is resolving every **quantity the spec
promises to use** to the thing that produces it, and it happens before a single `### Task` block is
written — a measure resolved after the tasks exist gets rationalised into the task that already
mentions it, instead of stopping the plan.

Build the list from the spec: every sort measure, every threshold, every condition input, every
"clears by", every count and denominator — anything a task's `Interface` would end up naming. Each
resolves to exactly one of three states, and the table ships in the plan:

| State | What it requires |
|---|---|
| **exists** | a `file:line` the plan cites, verified by reading the range |
| **new** | the task in this plan that produces it, named — and that task is in the order before its consumer |
| **unresolvable** | the plan stops here and goes back to the spec |

**No `Interface` line may name a measure that is not in that table.** A task whose sort key resolves
to nothing is not a task yet, and writing it anyway converts a cheap planning conversation into a
mid-implementation rewrite.

**The trap this exists for: a measure written as a concept has no identifier to grep.** The
self-review's grep-verified check below catches names the *plan* wrote down; it never fires on nouns
the *spec* used, because there is nothing to search for. A measure that is already a field name
carries its own receipt and gets checked; "sorts by impact" or "clears by decay" reads as real,
passes every review unchanged, and fails at the implementer's desk. What can be grepped gets
checked; what is phrased as a concept never is.

So the resolution pass runs on the spec's **prose**, noun by noun, not on the plan's citations.
"Ranked by value", "worst first", "sorts by impact", "clears when the world resolves it" are all
entries. Where the spec's own wording is the only thing that makes a measure sound real, that is the
signal, not the reassurance.

Phases are check-in pauses on one branch, never PRs — `AGENTS.md` owns the PR unit. A staged plan
(stage → A/B → stage) interleaves `### Gate` blocks between task groups — Arms / Reads / Merge
condition. A gate is not a task: it has no Files and no Interface, and it is where a
booking-at-a-gate lives (see Not covered).

## Plan-level fields

After the tasks, these sections — the first three always, the fourth whenever any task carries a
`New:`:

**Verification** — how the finished feature is proven in the galaxy, not in fixtures: which sim
metric moves, read at **both horizons**, cohorted; the build gate (`npm run build` — `tsc && vite build`); and
any new harness metric needed because the symptom would otherwise hide inside an aggregate.

**Doc fold** — which active docs this feature makes stale, which planned docs it supersedes, and the
note that this working file is deleted at ship. The fold happens on the branch, before the final
review — a fold left to "later" is how a planned doc ends up describing shipped code.

**Not covered** — the negative statement, in the same breath as the plan. What the plan deliberately
leaves out, and for each item: **booked** (a roadmap row, named), **dropped** (a reason, written),
or **booked at a gate** — when the booking's own evidence is produced by a stage gate, name the
booking in that gate's merge condition, so the check is still text.
An exclusion with none of the three is a finding against the plan. The field is attached to finishing the plan
because producing text beats doing the check — this way the check is the text.

**Net-new UI** — every `New:` from the tasks' `Reuse` fields, collected into one list. This list
goes to the owner **before `/implement-plan` starts**: a new component is a decision he redirects
cheaply here and expensively after it ships. Where the feature is UI-heavy, AGENTS.md's
approved-prototype rule rides on this list — the prototype shows exactly these pieces. An empty
list is stated, not omitted, so its absence is a claim the review can check.

## Self-review — the final step, not a second gate

Minutes, by the author, before committing the plan. No agent dispatch.

- **Every named identifier, grep-verified.** Each existing file, function, constant or field the plan
  references exists (`grep` / `npm run impact`); each `(new)` name does not already exist. A plan
  naming things that aren't there is hazard 5 at plan level. A `file:line` citation is verified by
  **reading the range** — grep proves the name exists somewhere, not that the line is where the
  plan says, and same-named files in sibling directories make the wrong-directory citation easy.
- **Every measure in the resolution table still resolves.** Re-read the table against the finished
  tasks: each `new` names a task that exists in the order and sits before its consumer, and no
  `Interface` line names a measure the table does not carry. This is the cheap re-check of the pass
  above, not a substitute for running it first.
- **Files lists are walked against a sibling, not imagined.** For any task adding to a shape that
  already has members — a persisted field, a map mode, a response type, a processor signal — find
  the nearest existing member and grep every file *it* touches; that set is the floor. Verifying the
  named files exist is not the same check and will not catch the omission: a persisted field needs
  the tick joins and the resettlement clears, not just the type and the writer; a value map mode
  needs the zoomed-out aggregation, formatting, layer, canvas, shell and tick invalidation, not
  just a ramp and a service. Each omission surfaces mid-build, where the implementer either expands
  scope unreviewed or stops and costs a round trip.
- **Nothing dropped between spec and plan.** Every interaction row and accepted amendment in the spec
  lands in some task. The difference between spec scope and plan scope is either empty or listed in
  **Not covered**.
- **No code.** A task containing a function body, an `if`, or a derived formula is implementing —
  move the decision into the spec or cut it. Signatures and types are the ceiling. Quoting a
  spec-authored formula, invariant or constant value is not deriving one — those carry verbatim;
  deriving something the spec never wrote is.
- **Shared quantities stay inside the spec's evidence.** A task touching a symbol the spec's row-1
  table never analysed is not a planning detail; it is missed spec scope. Go back. The spec's own
  `npm run impact` table is the licence for the symbols it covers — re-run the tool only for symbols
  the plan leans on beyond it.
- **Each detection list read back against its own Interface.** Every branch arm, boundary and
  contention the interface implies has an entry; a list of happy-path restatements is an unfilled
  field wearing a filled one's clothes. Two named checks inside this read-back: no entry
  **contradicts** the Interface it tests, and every value the task **authors** (writes, computes,
  exposes) is pinned by some entry, not only the values it categorises — a list that pins which
  band a value lands in but never the sort key the consuming task reads leaves that key free to be
  wrong.
- **Every `Reuse` entry opened, every `New:` searched.** A reused component's props were read this
  session, not remembered from an earlier one; a `New:` name must not already exist under a name
  the search missed — grep the behaviour's words, not the proposed name.

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
