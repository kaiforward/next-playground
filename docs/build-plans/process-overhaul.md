# Process overhaul (2026-08)

Work on the game is halted until this lands. Delete this doc when the replacement skills ship — the
rules that survive live in `AGENTS.md`, and the code is the source of truth for everything else.

## Why

Kai stopped a PR mid-flight on 2026-08-02 and called for a full overhaul of how we plan, design and
implement. Not a one-off complaint — he named "the last 10 PRs, maybe more", and reiterated it on
2026-08-03: "the last few sessions have been a complete failure."

## The three named failures

**1. Asserting on false premises far too early.** The real problem gets missed and hours go into
whack-a-mole on a ten-minute mistake.

**2. Communication Kai can't parse.** Too long, too much jargon, inference written in the same voice
as fact, a story instead of an answer.

**3. Surfacing important findings after the decision, not before.** The pattern: run the whole review
process, let Kai merge, then append "oh, also — three or four things you might want to consider for
the work we just merged." He has to make a decision without its inputs, and then live with it. Named
2026-08-03; the rule now lives in `AGENTS.md` → Review process.

## Why more rules won't fix it

The rules that get dropped are the ones requiring work *before* producing output — "verify first",
"map interactions with ALL shipped mechanics", "read both horizons". Style rules mostly get followed.
Producing text beats doing the check.

Adding rules has already failed. The strongest evidence is the worked example below: **the guarding
rule already existed, was complete, and did not fire.** So instruction mass is the suspect — a large
body of competing directives where individual rules stop firing. That is a hypothesis, not a
measurement, and the cut below is worth doing on its own merits either way.

## Kai's direction

- **Drop superpowers for this project.** It is built for webapps; this is a simulation game with
  densely interconnected systems, and none of its planning skills ask what other systems a change
  touches. Concrete instance: its brainstorming skill required a design and approval *before* the
  measurement, and the whole item turned on that measurement.
- **Write project-specific skills instead**, built around interconnected game systems. The recurring
  miss is **events** — repeatedly forgotten as an interacting system.
- **Evidence is the deliverable, not a design.** No plan, spec or options until a number is on the table.
- Long SDD workflows, long specs and expensive reviews have NOT prevented any of this.
- **If a rule, doc or memory doesn't change what gets done on a task, delete it.**

## The worked example to design against

Design the new skills against this specific case, not the abstract complaint. It is failure #1 with a
complete paper trail.

**What happened.** Phantom `MIN_DEMAND` demand was investigated, measured at the 416-cycle horizon
(0.3% of deliveries), declared "a one-time founding tax", and written down as **RULED OUT** — with a
"do not re-open it" instruction attached. Re-measured at 42 cycles it was **24.7% of all delivered
cargo**, over 90% for the scarce advanced goods. It was the cause. Fixing it (#211) took `luxuries`
consumer cover 0.02 → 0.81.

**Five properties that make it the right target:**

1. **The guarding rule already existed, was complete, and did not fire.** AGENTS.md's two-horizon rule
   states both directions and ends "Never quote one at the other's question." It was read past.
2. **The rule's own text carried the wrong example** — it listed this very finding among the "serious
   defect findings killed by simply running longer", teaching the next reader it was a false positive
   while the paragraph below explained why a startup fault is invisible at equilibrium. Nobody noticed
   for weeks.
3. **It was recorded in two places that corroborated each other** (the backlog and memory), so
   checking one confirmed the other. Duplication read as confirmation.
4. **A negative result is the most durable thing you can write, because nobody re-tests it.** A wrong
   positive dies the moment someone builds on it. A wrong "ruled out" survives and actively steers the
   next investigation away from the cause.
5. **The arithmetic was right and the conclusion was still wrong**, which is why "show your numbers" is
   not sufficient on its own. Every figure was accurate; the error was the inference. **A startup fault
   can set the equilibrium level, so "it is only 0.3% of flow now" is not evidence it did not cause the
   state you are standing in.** Any new skill that asks for evidence must also ask *what the evidence
   licenses*.

**The transferable form:** the scope of a measurement must travel with its conclusion. A number
stripped of the conditions it was taken under is what turns into a false premise later.

## Done so far

- **`AGENTS.md` cut 43%** (5,008 → 2,863 words). Every rule survives as an imperative; the war story
  attached to it does not. Deleted whole: Design Principles (generic advice already specified by
  Project Structure + Conventions), Quality Checklist (duplicated Conventions), Troubleshooting.
  Added the pre-merge disclosure rule and named **events** in the map-all-interactions rule.
- **One queue.** `docs/BACKLOG.md` (330 lines of essays, 28 items) and memory's parallel "Next up"
  list collapsed into `docs/ROADMAP.md` — ordered, one item = what / next step / what's known-dead.
  Memory now tracks only *where we are* on it.
- **Memory pruned** from 20 files to the ones that still change what gets done; shipped-work narrative
  deleted, recurring traps consolidated.

- **`docs/planned/` corrected.** Seven of fourteen docs described shipped code, in the tense of work
  still outstanding. Five fixed in place; two (`necessity-weighted-unrest.md`,
  `economy-rationing-amendment.md`) have shipped in full and are booked into PR6's doc fold.

## The sequence we are building

```
/brainstorm  → chosen idea + its falsifier   (prose, no forced-choice lists)
/measure     → concrete evidence             (falsified → back to /brainstorm)
/feature-spec→ functional spec               (entry condition: evidence exists)
/spec-review → revised functional spec       (rubric = the design hazards)
/build-plan  → implementation plan           (files + interfaces, NOT the code)
implementation → PR
/uber-review → merge
```

Handoff is **a file, not a conversation**: one working file per feature at
`docs/build-plans/<feature>.md`, accreting `## Idea` → `## Evidence` → `## Spec`. Each skill's entry
condition is the previous section existing, so it resumes in a fresh context. `/clear` between
`/measure` and `/feature-spec` is the default — what remains in context by then is mostly refuted
probes, and carrying those next to real numbers in the same voice is failure #2 self-inflicted.

**Why three ranks of guarantee, and why we prefer the first:**

1. **Baked into a tool** — cannot be skipped. `npm run simulate` running both horizons by default
   fixed permanently what "read both horizons" as a rule never did.
2. **A step that emits an artifact** — visible when skipped.
3. **A rule in a file** — fires only if read and applied. This is where every failure lives.

## Two mechanisms that worked — integrate these into the remaining skills

From dogfooding `/measure` on roadmap item 2. Both are cheap, and both caught a real error *in that
run* rather than in principle. They are the transferable part; the measurement itself was incidental.

**A. Pre-commit the guard.** Write the thing that would kill your conclusion, and `git commit` it,
*before* the conclusion exists. This is what upgrades a rank-2 artifact towards rank 1: skipping a
step normally shows up as an **absence**, which is invisible, but editing a pre-committed guard shows
up as a **diff**, which is not. It fired immediately — while writing up results the falsifier got
quietly condensed into a tidier version, and `git diff` against the earlier commit exposed it. Nobody
can audit an intention; they can audit a diff.

Applies to: `/brainstorm` (its terminal falsifier should be *committed*, not merely stated),
`/spec-review` (is this spec's falsifier in the history, or written alongside its conclusion?).

**B. Force the negative statement.** Every claim carries, in the same breath, what it does **not**
support. `/measure`'s `Licenses` field is the instance. It works for the reason this file already
identifies — producing text beats doing the check — so the check is attached to the text-production
itself rather than left as a separate step to skip. This is what surfaced that item 2's premise was
backwards: the numbers were fine and the write-up was nearly done before the field forced the question.

Applies to: `/feature-spec` (a "what this spec does not claim" field), `/build-plan` (what the plan
does not cover), `/uber-review` (what a finding does not establish).

**Why these two and not more rules:** neither asks anyone to be careful. A shows the skip, B makes the
check a precondition of finishing the sentence. That is the same shape as rank 1, applied where a tool
cannot reach.

## Done

- **`npm run impact`** — rank 1. Answers "who else reads this?" from the tracked tree, which is the
  question that, answered from memory, created `TARGET_COVER`, `MIN_DEMAND` and `surplusDrawable`.
- **The design-hazards worksheet** (`.agents/skills/shared/design-hazards.md`) — rank 2. Six hazards,
  each from a defect that shipped, with rows filled from command output.
- **`/measure`** — rank 2. The stage superpowers has no equivalent of. **Dogfooded on roadmap item 2
  (falsified).** The run found two gaps, both now fixed: it wrote evidence into `docs/ROADMAP.md`
  (contradicting the roadmap's own header) and it sent you to patch tracked engine code with no revert
  step. It also produced mechanisms A and B above, which are the reusable output.
- **`/spec-review` rubric rewritten to the design hazards** — the worksheet audit is the review's
  first step ("is each row filled with evidence, or with assertion?") and a required table in the
  report; an unfilled in-scope row is automatically `major`. Each lens owns its rows (1/2/5
  consumer-sweep, 3 interaction-attack, 4/6 consistency-attack): an `evidence` row gets spot-checked
  for completeness, an `assertion`/`missing` row the lens fills itself and attacks with. Mechanism A
  carried in as the falsifier git-history check; validating it against the item-2 working file
  exposed that a file-scoped `git log` reads a migration commit as authorship — the check searches
  `docs/` history-wide and compares the falsifier's first-committed text against the spec's current
  text.
- **`/build-plan`** — rank 2 by format: four required task fields (`Files / Interface / Proves /
  Consumes`) and three required plan sections (Verification, Doc fold, Not covered), so a skipped
  part is a visible hole rather than an absence. Mechanism B carried in as **Not covered** — every
  exclusion booked or reasoned, attached to finishing the plan. Self-review is the final step:
  minutes, a checklist, no agent dispatch.

## Left to do

1. **`/brainstorm`** — prose discussion, no forced-choice lists, terminal state is `/measure` rather
   than a spec.
2. **`/feature-spec`** — four-field header, hazard worksheet, refuses to start without evidence.
3. **Carry mechanisms A and B into each skill as it is written**, per the applies-to lines above. Not a
   separate task — a checklist item on items 1-2. The test of whether it worked is the same as for
   `/measure`: dogfood the skill on a real queue item and see whether the mechanism catches something.
   `/spec-review` and `/build-plan` both still await that dogfood — the natural moment is roadmap
   item 6, whose next step is the spec-review gate itself, with planning right behind it.

The plain-language-before-numbers question is closed — Kai called it yes on 2026-08-03: a required
`Meaning` line now leads `/measure`'s report frame (rank 2). The rank-3 preference in
`~/.claude/CLAUDE.md` had demonstrably failed to fire during the item-2 write-up.
