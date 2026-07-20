# Design: /spec-review skill + uber-review cost/order updates

**Date:** 2026-07-20
**Status:** Approved design, pre-implementation
**Scope:** Tooling/markdown only — no game code. Single PR.

Two workstreams, one PR:

- **A.** A new `/spec-review` project skill — adversarial review of a feature spec against the
  existing codebase, run *before* writing-plans. Closes the spec-vs-reality gap that code review
  structurally cannot catch (uber-review's Lens 2 checks code-vs-spec; nothing checks the spec
  itself against shipped behaviour).
- **B.** Three updates to `/uber-review`: doc-fold ordering (B1), batched validation (B2),
  game-shaped reviewer prompt additions (B3).

---

## A. `/spec-review` — adversarial spec review skill

### Shape

Project skill at `.claude/skills/spec-review/`:

```
.claude/skills/spec-review/
  SKILL.md                      # orchestrator playbook
  prompts/consumer-sweep.md     # lens 1
  prompts/interaction-attack.md # lens 2
  prompts/consistency-attack.md # lens 3
```

Invocation: `/spec-review <doc-path>` with optional `--effort=quick|standard|deep`.

| Effort | Lens agents | Model |
|--------|-------------|-------|
| `quick` | 1 agent carrying all three lens briefs | sonnet |
| `standard` (default) | 3 parallel agents | opus |
| `deep` | 3 parallel agents | fable |

**When to use:** specs with real cross-mechanic surface — economy, tick processors, anything
changing shipped signals/primitives. Pure-UI slices and tooling changes skip it (nothing for the
consumer sweep to sweep). Workflow slot: after the spec is written and approved, **before**
writing-plans. One run per feature.

### Pipeline

1. **Orchestrator maps the spec.** Read the spec doc in full + `docs/SPEC.md`'s system
   interaction map. Build two lists: **changed primitives** (every signal, field, formula,
   threshold, trigger the spec adds/changes/removes) and **touched mechanics** (shipped mechanics
   the spec names, plus shipped mechanics it plausibly interacts with but doesn't name).
2. **Per-spec sharpening.** For each lens, the orchestrator writes a 2–4 sentence attack framing
   specific to this spec, derived from the lists — pointing the lens at the spec's probable blind
   side without telling it what to conclude. (Prototype-validated as the highest-value step: the
   framing "the spec redesigned the push side of each loop — sweep the receiving/clamping
   consumers whose triggers were previously synonymous with pathology" is what found the deadlock.)
3. **Dispatch lens agents in parallel** (general-purpose, model per effort dial). Each receives:
   its canned lens prompt + the sharpening + the spec path + the changed-primitives list. Agents
   work the real codebase (grep/read), not the doc alone.
4. **Orchestrator verification.** Spot-verify every critical/major claim in the cited code before
   accepting it; drop unverified findings into an audit trail (never silently). Mark cross-lens
   convergence as high-confidence. Dedup across lenses by orchestrator judgment (pools are small —
   no dedup agents).
5. **Report.** Save to `.claude/reviews/spec-<docname>-<timestamp>.md` + terminal summary. Per
   finding: severity, plain-terms claim, `file:line` evidence, verification result, and a
   **concrete amendment proposal** ready to apply. Then a **refuted angles** section (every attack
   tried that didn't land, and why), then the audit trail (dropped findings, per-lens stats).
6. **Triage gate.** The user calls each finding: **accept** (amend spec), **reject** (intended
   behaviour / wrong finding — recorded), or **defer** (real but out of scope — booked to
   `docs/BACKLOG.md` or the spec's open-questions section). Nothing touches the spec until called.
7. **Apply.** Orchestrator edits the spec with only the accepted amendments and shows the diff.
   Spec proceeds to writing-plans pre-hardened.

### The three lenses

1. **Consumer sweep** (`prompts/consumer-sweep.md`) — for every changed primitive, enumerate
   *every* consumer in code (grep-driven, exhaustive); hunt consumers the spec doesn't account
   for. Classic catch: the spec redesigns what a signal means and a downstream clamp/trigger
   still treats the old meaning as pathology.
2. **Interaction attack** (`prompts/interaction-attack.md`) — walk the shipped-mechanics map and
   attack the spec with each mechanic it *doesn't* name (decay, staffing, pop-viability,
   treasury, …): "spec changes X; this mechanic reads/feeds X here — what happens?" Enforces the
   CLAUDE.md "map interactions with ALL shipped mechanics" practice as a gate.
3. **Consistency / failure-mode attack** (`prompts/consistency-attack.md`) — spec-internal
   contradictions, unhandled edge cases/states, dynamic stability (deadlock, oscillation,
   runaway feedback), load-bearing unstated assumptions.

Standing rules baked into all three prompts (prototype-validated):

- **Verify in code before reporting** — kills hallucinated findings.
- `file:line` evidence on every claim.
- Severity-ranked: `critical` (spec as written builds the wrong thing / breaks shipped behaviour
  / deadlocks) · `major` (missed scope requiring spec amendment) · `minor` (clarification-level).
- **Report refuted attack angles explicitly** — a refuted angle is a deliverable, not a failure.
  No padding; report honestly when an angle doesn't land.

Output schema (JSON in fenced block, matching uber-review conventions): `findings[]` with
`{claim, file, line, severity, evidence, proposed_amendment}` + `refuted_angles[]` with
`{angle, why_refuted}`.

### Cost shape

Standard run ≈ 3 × ~175K tokens at opus (prototype-observed) + orchestrator verification reads.
Once per feature, before build effort is at risk. Accepted first-iteration cost; observe
per-feature spend and re-dial if needed.

### CLAUDE.md updates (workstream A)

Add to the review-process bullets: run `/spec-review` on an approved feature spec (specs with
cross-mechanic surface) before writing-plans.

---

## B. uber-review updates

### B1 — doc-fold ordering + review-stage determination

**Problem:** the architect's Lens 2 already owns `fold-vs-spec-mismatch`, but SKILL.md §9 runs
the doc lifecycle *after* the review, so the fold never exists at review time and the check can
never fire.

**Change:**

- Doc lifecycle happens on the branch **before** the final whole-branch review. §9 drops its
  doc-lifecycle step (replaced by a verification note: the fold should predate this point).
- New playbook step — **review-stage determination**, replacing any need for a flag. The
  orchestrator infers the stage from signals it already has:
  - Diff base = shared feature branch → **phase** review; no fold expected; Lens 2 behaves as
    today (silently skips when no doc present).
  - Diff base = `main` on a feature branch, run as the pre-merge whole-branch review (known from
    session context — the user asks for it deliberately) → **final** review; the architect is
    told a diff with *no* doc fold is itself a `major` finding (doc lifecycle forgotten).
  - Genuinely ambiguous (e.g. single-PR feature reviewed mid-work against main) → ask the user;
    one question instead of a wrong assumption.
  - The determination is stated in the report header (e.g. `Stage: final (shared→main)`).
- Matching CLAUDE.md git-workflow bullet update: doc lifecycle on the feature branch **before the
  final review** (not just before the squash-merge).

### B2 — batched validation (replaces per-finding validators)

**Problem:** step 5 dispatches one validator agent per finding (opus for blocker/major). Each
agent re-pays the fixed context overhead and re-Reads the same source files; observed cost
50–100K tokens per finding, ≈1.5–2M for a 17-finding pool.

**Change:**

- Group the finding pool **by file**; pack groups into batches capped at **~8–10 findings**
  (split oversized file groups; pack small groups together up to the cap, keeping same-file
  findings in the same batch).
- One validator agent per batch. Batch model = highest severity present: `opus` if any blocker,
  `sonnet` if any major, `haiku` if all-minor.
- `prompts/validator.md` rewritten for multi-finding input: validate each finding independently,
  quote the decisive line per finding, return a per-finding array
  `{index, confidence, reason}` — same 0–100 scale, same lower-when-uncertain bias, same
  threshold filter downstream.
- Validator output gains a `duplicates` field (`[[indexA, indexB], …]`) flagging same-issue
  findings it saw side by side. **Dedup Pass 2 (per-pair haiku agents) is deleted**; the
  orchestrator merges validator-flagged duplicates instead. Deterministic Pass 1 stays.

Expected effect: a 17-finding pool ≈ 2–3 validator agents instead of 17, with same-file reads
amortized.

### B3 — game-shaped reviewer prompt additions

Verdict from re-reading all nine prompts: world-integrity, boundary-safety, and performance are
already properly rewritten for the no-auth in-memory sim. Targeted additions, no rewrites:

- **world-integrity** + category `save-version-not-bumped`: a `World` shape change (field
  added/renamed/removed) with no `SAVE_FORMAT_VERSION` bump in `lib/world/save.ts`. Versioning
  exists (v8 as of #194; prior-version saves are rejected by design) — an unbumped shape change
  silently corrupts loads. Severity `major`.
- **tests** + category `no-sim-evidence`: a new gameplay mechanic (new tick processor / economy
  behaviour) shipping with only isolated engine fixtures and no sim-harness run/metric — the
  "fixtures pass while the galaxy is 100% broken" trap. Severity `major` for new processors,
  `info` otherwise.
- **user-journey** + Foundry-theme conformance (rounded corners outside DetailPanel modal +
  FilterBar chips; numeric values not `font-mono`; headings not `font-display`) and the
  tick-invalidation convention (dynamic data rides tick-invalidated queries via
  `useTickInvalidation`; static metadata on `staleTime: Infinity`; no per-page arrival
  subscriptions or viewport-keyed fetches for tick-scoped data).
- **No changes** to conventions, silent-failures, data-contract, boundary-safety, performance,
  or the architect's lens definitions.

---

## File inventory

**Create:**

- `.claude/skills/spec-review/SKILL.md`
- `.claude/skills/spec-review/prompts/consumer-sweep.md`
- `.claude/skills/spec-review/prompts/interaction-attack.md`
- `.claude/skills/spec-review/prompts/consistency-attack.md`

**Edit:**

- `.claude/skills/uber-review/SKILL.md` — B1 (§9 + stage-determination step), B2 (step 5 rewrite,
  delete step 4.6 Pass 2)
- `.claude/skills/uber-review/prompts/validator.md` — B2 multi-finding rewrite
- `.claude/skills/uber-review/prompts/world-integrity.md` — B3
- `.claude/skills/uber-review/prompts/tests.md` — B3
- `.claude/skills/uber-review/prompts/user-journey.md` — B3
- `CLAUDE.md` — review-process bullets: spec-review slot (A) + doc-lifecycle-before-final-review
  (B1)

**Not touched:** game code, `docs/SPEC.md`, `docs/active/`, `docs/planned/`.

## Decisions log (settled during brainstorm)

- Spec-stage gate only — no second plan-stage run (architect Lens 2 covers code-vs-spec
  downstream).
- Fixed 3 lenses + per-spec sharpening — not fully adaptive, not canned-only.
- Report + proposed amendments, applied only on user accept — no auto-amend.
- Opus lens default, dial to sonnet (quick, single merged agent) / fable (deep).
- Validation batched by file with severity-tiered batch model — not strictly-one-agent, not
  per-finding-with-cheaper-models.
- Review-stage determination by inference (diff base + session context) — no `--final` flag.
- First-iteration cost accepted; observe per-feature spend before re-dialing.
