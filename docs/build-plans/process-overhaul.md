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

## Left to do

1. **Design the project-specific skills.** Open question, and the real work. The shape has to answer:
   what makes an agent actually do the check before producing output? Candidates worth weighing —
   a system-interaction map that must be filled in from the code (with events as a required row); a
   measurement-first gate that refuses to accept a design until a number exists; making the
   *evidence*, not the plan, the artifact that gets reviewed.
2. **Decide what replaces `/spec-review` and the superpowers workflow**, or whether they survive in
   reduced form.
3. **Prune the docs the same way** — `docs/planned/` and `docs/build-plans/` have not had the same pass.
