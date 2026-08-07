---
name: implement-plan
description: Execute a committed build plan task-by-task with dispatched implementers. Use when the user runs /implement-plan, or when a build plan exists in docs/build-plans/ and implementation is about to start.
---

# /implement-plan — the plan, executed without leaks

This stage turns a build plan into a PR. The generic execution skills it replaces have never heard
of `Proves`, red-proof, the SDD ledger or the per-task review gate — and that seam is where ~278
unpinned behaviours once leaked through a fully filled plan. The two leaks this skill exists to
close: **tests that were never seen red** pin nothing, and **issues noted per-task and not fixed
per-task** are forgotten by the time implementation ends, then expensively re-found at review.

**Entry condition: the plan exists and is committed** — `docs/build-plans/<feature>.md` with
four-field tasks (`Files / Interface / Proves / Consumes`, `Proves` a detection list) and its
gates. No plan → that is `/build-plan`; go back. Work happens on the feature branch per `AGENTS.md`.

The per-task definition of done is `docs/active/engineering/feature-process.md` → Implementation
gates (checks green, red-proof, doc-sync grep, mechanic-level proof). This skill is the
orchestration around those gates, not a restatement of them.

## The ledger

`.superpowers/sdd/<feature>/progress.md` — created before the first dispatch, updated after every
task, gitignored. It is the implementation's memory; anything not written here is treated as never
having happened. Two required sections:

**Per task** — status; model + effort dispatched (and why, if not the default); the **red-proof
record**: one line per detection-list entry naming the test that pins it and how it was seen red;
one line stating **what this task's tests do not prove**; the review verdict; the commit sha.

**`## Issues`** — every finding, from any source (the per-task review, the implementer, the
session's own reading), that was not fixed before that task's commit. One row each: severity ·
source task · `file:line` · one-line claim. There are exactly two dispositions at task time —
**fixed now** or **ledgered here**. A finding that is neither is dropped work, and dropping it
silently is the failure this file exists to prevent. "Minor" is a severity, not a disposition.

## Per task

1. **Dispatch one implementer per task.** The prompt is the task verbatim (all four fields), the
   spec sections it implements, and the gates reference — not a paraphrase; the plan was written to
   be executed from. Model and effort per the tiers below, always explicit.
2. **TDD, where the red run is the detection list executed item by item.** Tests come from the
   `Proves` entries before implementation; each entry is seen red once — break the listed
   behaviour, watch the named test fail, restore. The implementer returns the red-proof record,
   the does-not-prove line, and real command output — never "tests pass" as prose.
3. **Per-task review, before commit.** A reviewer agent checks the diff against the task's
   `Interface` (contract drift), its detection list (every entry actually pinned; vacuity), and
   the code-standards rules. This is checklist review — it verifies written invariants.
4. **Triage every review finding on the spot**: fix now (cheap, in-diff, correctness — the
   implementer fixes it before the commit) or ledger it in `## Issues`. No third state.
5. **The session verifies the claims.** Run the suite and build yourself; spot-check the red-proof
   record by re-breaking at least one listed behaviour; and treat **"the instrument prints X" as a
   claim verified only by running the instrument** and matching its output against the plan — a
   plan once asserted its gate reads were "all now printed" while two had never been implemented,
   and nothing caught it until the gate ran.
6. **Commit per task**, message naming the task. Update the ledger before moving on.

## Gates

A `### Gate` block is executed by the **session**, never a subagent. Run the named arms (both
horizons where the plan says so), take every read, and turn each merge condition into a number or
a written decision **landed in the destination the plan names** before the next stage's first
dispatch. Decisions that belong to the owner — constants, boundaries, spec amendments — go to them
with the data in front of them; the gate blocks until they call it.

## The closing fix wave — implementation ends here, not at the last task

Before any review is requested, walk `## Issues` end to end. Every entry reaches a terminal state:

- **fixed** — batched into a dispatched fix wave; the session verifies the batch's claims and
  makes the judgement calls it flags.
- **rejected** — a written reason (wrong finding, intended behaviour) a reader can disagree with.
- **booked** — a named destination, stated in the turn's response and named in the commit, per
  `AGENTS.md`. Default remains: cheap + self-contained + in a touched file → fix, don't book.

"Still open" is not a terminal state, and "review will catch it" is the process failing twice —
the review re-finding a known issue costs a full review finding to re-learn what the ledger
already said. The disposition table goes into the review handoff so `/uber-review` sees what was
already caught and how it was resolved.

## Models

Resolve tiers through `.agents/model-tiers.md`; effort explicit on every dispatch, never inherited.

- **Implementer: `strong` by default.** A task with a written Interface and detection list is
  bounded implementation — the pipeline already spent the judgment upstream in the spec and plan,
  and that is the point of paying for those stages. Escalate a task to `frontier` only when the
  session flags it as judgment work — it interprets the spec beyond its interface, performs
  cross-mechanic engine surgery, or was gated on a spec amendment — and record why in the ledger.
- **Per-task reviewer: `strong`** — it verifies written invariants against a written list.
  Open-ended judgment review is `/uber-review`'s job, later, with its own dials.
- **Fix wave: the session's call per batch** — `strong` for mechanical, well-specified fixes;
  `frontier` where the batch needs real reasoning (a fix that could weaken a test, cross-cutting
  cleanups, a finding the session suspects is wrong). Record the choice in the ledger.
- Effort: `high` for engine/tick work, `medium` for mechanical harness and report tasks.

## What this skill does not do

- It does not re-plan. A hole found mid-build goes back to `/build-plan` (missed task scope) or
  the spec (wrong mechanism) — patching inline is how the code and the plan end up describing two
  different features.
- It does not run `/uber-review`, and it does not merge — both sit after the fix wave.
- It does not do the doc fold; the plan's Doc fold section owns that, on the branch, before the
  final review.
- It does not run the mutation sweep in-session — that rides the periodic overnight batch; the
  red-proof record is the synchronous guarantee a test could ever fail.
