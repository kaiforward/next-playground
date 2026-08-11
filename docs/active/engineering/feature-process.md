# Feature process

How a feature moves from idea to merged code. Three principles shape every stage: **evidence comes
before design**, **handoff between stages is a file, not a conversation**, and **every gate emits an
artifact**, so a skipped step is a visible hole rather than an invisible absence.

`AGENTS.md` carries the short-form rules that must fire in any session; this doc is the full pipeline
those rules belong to. Review-agent dispatch (which model, which reasoning effort, per lens) is owned
by each skill's effort dial plus `.agents/model-tiers.md`, not duplicated here.

## The pipeline

```
brainstorm     → chosen idea + its falsifier   (prose discussion, no forced-choice lists)
/measure       → concrete evidence             (falsified → back to brainstorm; that is a success —
                                                it cost one measurement instead of a PR)
feature spec   → functional spec               (entry condition: evidence exists; hazard worksheet filled)
/spec-review   → revised spec                  (cross-mechanic surface only; rubric = the design hazards)
/build-plan    → implementation plan           (files, task order, interfaces — not the code)
/implement-plan → PR                           (SDD ledger, per-task gates below, closing fix wave)
/uber-review   → findings on the table         (each phase into shared; doc lifecycle before final review)
merge                                          (human-gated — everything known goes on the table first)
```

Brainstorming and spec authoring are done directly in conversation (no dedicated skills yet); the
other stages have skills. The design-hazards worksheet (`.agents/skills/shared/design-hazards.md`)
is filled at design time and audited as `/spec-review`'s first step.

## Handoff is a file

One working file per feature at `docs/build-plans/<feature>.md`, accreting `## Idea` → `## Evidence`
→ spec → build plan. Each stage's entry condition is the previous section existing, so any stage can
resume in a fresh context — `/clear` between `/measure` and the spec is the default, because what
remains in context by then is mostly refuted probes, and carrying those next to real numbers in the
same voice reads as fact. The file is transient: deleted when the feature ships, after anything
durable moves to `docs/active/` or memory.

## Ranks of guarantee

When adding a safeguard, prefer the highest rank available:

1. **Baked into a tool** — cannot be skipped. `npm run simulate` reading both horizons by default
   fixed permanently what a "read both horizons" rule never did.
2. **A step that emits an artifact** — visible when skipped: the worksheet, the committed falsifier,
   the mutation survivor report.
3. **A rule in a file** — fires only if read and applied. This is where failures live; when a rank-3
   rule keeps being dropped, promote it upward instead of rewording it.

Two mechanisms upgrade rank-3 rules toward rank 2, and every skill carries them where they apply:

- **Pre-commit the guard.** Write the thing that would kill your conclusion and `git commit` it
  *before* the conclusion exists. Skipping a step shows up as an absence, which is invisible;
  editing a pre-committed guard shows up as a diff, which is not.
- **Force the negative statement.** Every claim carries, in the same breath, what it does **not**
  support — `/measure`'s `Licenses` field, `/build-plan`'s `Not covered` section. The check is
  attached to producing the text, so producing text can no longer substitute for doing the check.

## Implementation gates — definition of done, per task

1. **Checks green**: `tsc` clean, `npx vitest run` green, and `npx next build --webpack` for any
   change with a build surface. Quote real output; never assert "tests pass" without running them.
2. **Red-proof gate**: every new or changed test has been *seen red* — break the premise it protects
   (revert the change, or mutate the seam it pins), run the test, watch it fail, restore green. Say
   in the response that the gate ran and on what. A test never seen red is presumed vacuous: the
   recurring review finding is fixtures that coincide with the old behaviour, thresholds sitting
   exactly on a boundary, or assertions comparing a function to itself — all of which pass on first
   write.

   **A red-proof starts from green, fully-implemented code and ends in an assertion.** Break the
   named behaviour, watch the named test fail on a real "expected X to be Y", restore. A
   `Cannot find module`, a "not a function", or any other import/reference error is **not** a
   red-proof — it proves a file or symbol was absent, never that the test detects what it claims.
   Record the assertion message, not just the fact of failure: a record naming the break and the
   message is mechanically reproducible by a reviewer, and reproducing one is what turns a claim
   into evidence. An implementer that writes its tests first and reports their initial import
   failures has recorded nothing; that whole record is rejected and the gate has not run.

   Watch for the fixture that sits where the bug would not bind — a saturation cap tested only
   below saturation, a boundary tested only at its interior. Such a test passes against the broken
   code *and* the fixed code, which is the same vacuity as never seeing it red.
3. **Doc-sync grep**: when a change alters a symbol's *meaning or shape* — not just its value — grep
   that identifier across `lib/` and `docs/active/` for stale docstrings, module headers and doc
   claims. `npm run impact` finds the code readers; this finds the prose readers. The recurring
   review finding is a header or docstring falsified by the same diff that shipped it.
4. **Mechanic-level proof**: `npm run simulate`, both horizons, per `AGENTS.md` → Verifying changes.
   Fixtures passing while the galaxy is broken is the anti-pattern the whole pipeline exists to stop.

## The mutation sweep — a periodic batch, not an in-session gate

A surviving mutant is a code change no test noticed, and the bar is unchanged: **every in-diff survivor is
killed with a test or accepted with a stated reason** (equivalent mutant, dev-harness-only weight). No
Stryker disable comments — an accepted survivor is recorded in prose, where a reader can disagree with it.

What moved is the *scheduling*. The sweep no longer blocks requesting a review. It runs as a periodic batch,
typically overnight, as one cycle: **sweep → fix wave → re-sweep**, with the survivor report and the fix
wave's outcome brought to the next working session. Batching it is what keeps the synchronous loop short
enough to stay honest; the red-proof gate above remains the in-session guarantee that a test was ever
capable of failing.

The run is **always scoped** (`npm run mutation -- --mutate "<changed lib .ts files, comma-separated>"`),
never bare. The harness dev instrument (`lib/tick-harness/`) stays inside the scope: its output feeds
decisions, so a mutant it does not notice is a decision made on an unverified number. The incremental cache
lives in `reports/stryker-incremental.json` (machine-local), which makes a re-sweep minutes rather than
hours.

## Review and merge

The review rules live in `AGENTS.md` → Git Workflow / Review process; the load-bearing ones for the
pipeline's shape: each sub-feature is reviewed going *into* the shared branch while it is small; the
doc lifecycle (promote spec, update `docs/SPEC.md`, delete the build plan) happens on the branch
*before* the final review so the fold is part of the reviewed diff; and everything known about a PR
goes on the table before the merge, which is always a human decision.
