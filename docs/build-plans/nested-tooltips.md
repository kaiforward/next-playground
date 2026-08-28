# Nested tooltips

Working file for the nesting strand of the tooltip roadmap item. `/build-plan` consumes the `## Spec`
section below.

## Idea

Players meet unfamiliar vocabulary inside readouts — a yield percentage that is a *realised* yield
across *worked* *slots* on bodies of a given *quality band*. Today each of those is either unexplained
or explained in a tooltip that cannot itself be entered, so the only way to define four terms is a
paragraph that nobody reads.

The direction is the one Paradox ships in CK3 and EU5: a term opens a definition, and the terms inside
that definition open their own, so a player follows a concept as far as they care to and stops when
they have enough. Owner framing, unedited:

> it lets me follow concepts without being present with a wall of text I can keep reading more
> subjects If I want more information, so im happy spending some time getting the behaviour just right

The blocker is known and structural: `components/ui/popover.tsx:120` holds a module-level
`openPopover` pointer, so opening any popover closes whichever one is open. A child opening inside its
parent would close its parent. The file says so itself at `components/ui/popover.tsx:91` — "nesting is
out of scope".

## Evidence

The checkable premises here are about **interaction behaviour**, not simulated behaviour, so the
instrument is not `npm run simulate`. There is no horizon or cohort to quote, because no premise below
is a claim about the world model — a tick count would be noise in the Horizon column, not rigour. Two
instruments were used instead, and both are reproducible:

1. **The reference implementation.** The owner ran EU5 with the game open and reported observed
   behaviour directly, answering four specific questions put to him before he looked.
2. **A behavioural prototype.** `deep-tooltip-prototype.html`, published as an artifact, built to the
   observed model on real industry-panel content and the real glossary definitions, with every timing
   exposed as a slider. The owner tuned it and signed off.

Where a claim rests on the codebase instead, it carries a `file:line`.

### E1 — dwell-to-lock is the reference model

- **Meaning:** whether a tooltip becomes enterable on a timer or on an explicit act decides the whole
  interaction; every other question follows from it.
- **Claim:** in EU5 a tooltip opens immediately at the cursor, trails the cursor while a thin bar
  fills, then parks and becomes enterable. Every nested term repeats this with its own dwell.
- **Observation:** owner, with the game open — "The tooltip still moves while the bar fills […] The
  child appears anchored to the cursor"; "The fill bar is very thin, between the popover header and
  the content, I think every popover has a header here"; "every nested term needs its own dwell".
- **Corroboration:** CK3's documented default locks a tooltip after roughly two seconds of hover, with
  lock-on-middle-click offered as an alternative mode
  ([CK3 discussion](https://steamcommunity.com/app/1158310/discussions/0/5383446733863834918/)); EU5
  players describe the same — "It already locks when you hold the mouse still"
  ([EU5 discussion](https://steamcommunity.com/app/3450310/discussions/0/667222787666240771/)).
- **Licenses:** the model, and the fact that one dwell timer serves as both the lock and the guard
  against terms firing as the pointer passes over them. It does **not** license the specific
  durations — CK3's ~2s is for province-sized hover targets, ours are single words.

### E2 — the lifecycle rules

- **Meaning:** these decide whether a chain can be navigated at all; the first prototype failed on
  exactly these.
- **Claim:** a parent stays open when its child opens; returning to a parent closes its child; the
  whole stack dismisses when the pointer leaves it, near-instantly; only the top three are at full
  opacity and older ones fall back to roughly 25–50%.
- **Observation:** owner, with the game open — "parents stays when children open, going back to parent
  stops child surviving. Only the top three tooltips are full opacity, previous tooltips get opacity
  25-50% roughly […] Dismissing the whole chain jsut seems to be moving the mouse off the entire
  stack"; "The close seems pretty instant to me, maybe a tiny grace period".
- **Licenses:** the ancestor-stack model and the depth cue. It does **not** license the return grace
  in the spec below, which is ours — see N2.

### E3 — overlap is what makes transit survivable

- **Meaning:** the first prototype placed a child clear of its parent and was unusable past depth one.
  Understanding why decides placement.
- **Claim:** children overlap their parents, with no avoidance rule beyond staying on screen; the
  overlap is why the trip from a term to its own tooltip is a few pixels rather than a journey across
  the parent.
- **Observation:** owner, with the game open — "They they overlap, there seems to be no specific
  method, just avoiding going off the edge of the screen". And on the cost of the alternative, from
  operating the failed prototype: "the popovers sitting over each other saves a lot of screenspace,
  having them completely clear means a lot less popovers can actually fit on the screen, because there
  can never be any overlap".
- **Licenses:** cursor-anchored placement with no parent-avoidance, and the deletion of both aimed
  safe areas and cursor-latch transit from the design. Neither is needed once the gap is gone.

### E4 — the model works on our own content

- **Meaning:** the reference implementation's hover targets are provinces and armies; ours are words in
  a dense table. The model had to be shown to survive that difference before being specified.
- **Claim:** built to E1–E3 on the real deposit table, the real yield tooltip body and real glossary
  definitions — including five-deep chains, a deliberate cycle, and dense mid-sentence highlighting in
  running prose — the interaction is navigable.
- **Observation:** owner, after operating the prototype — "ive tested pretty thoroughly and everything
  seems to work well", with one change: open grace from 70 ms to 200 ms.
- **Licenses:** the four durations in the spec, as measured defaults. It does **not** license them as
  final for surfaces the prototype did not carry — the map especially, which has no term triggers yet.

### E5 — the conversion inventory

Counted from the tree, not from memory:

| Surface | Count | `file:line` |
|---|---|---|
| `TooltipTriggerLabel` term triggers | 17 | `system-astrography.tsx` (3), `industry-panel.tsx` (9), `population-panel.tsx` (3), `potential-yield-table.tsx` (2) |
| `<Tooltip>` roots, all sites | 13 | `quick-add-button.tsx:24`, `system-astrography.tsx:93,127`, `industry-panel.tsx:166,510,569,613,726,1008`, `logistics-panel.tsx:141`, `population-panel.tsx:32`, `potential-yield-table.tsx:61`, `provision-block.tsx:19` |
| Existing `Popover` consumers | 5 | `alert-flyout.tsx`, `alert-run.tsx`, `alert-settings.tsx`, `system-rings.tsx`, `tracker-row.tsx` |
| Control help that must stay a tooltip | 3 files | `form/checkbox-input.tsx`, `form/radio-option-group.tsx`, `map/map-overlay-controls.tsx` |

---

## Spec

**What changes:** Underlined terms in panels open a definition when the pointer rests on them. The
definition appears at the cursor and follows it while a hairline bar fills across the top; once the bar
is full the definition parks where it is and can be moved into and read. Terms inside a definition
behave exactly the same way, so a player can follow a concept as deep as they want, with each
definition laid over the one that opened it. Moving off the whole stack dismisses all of it; a chain
can be pinned to keep it while another is opened beside it. Help attached to a control — a checkbox, a
radio group, a map legend — is untouched and stays a plain tooltip.

**Why:** Terms in readouts are unexplained, and the current tooltip cannot be entered, so a definition
can never contain another definition. Owner decisions this spec encodes, each quoted:

- Vocabulary. "I believe they all read as tooltips and the difference is lost on them, but I keep
  saying tooltips here with the assumption that the popover component will be the one we use." → the
  player-facing and conversational word is *tooltip*; the component is `Popover`; the distinction
  survives only in code, where it is an accessibility difference rather than a naming preference.
- The model, wholesale. "let's rebuild the bench to this model", after "everything sounds correct".
- Timings. "only change was open grace changed to 200ms, everything else looks good".
- Dense highlighting is wanted, not noise — the owner's stated reason for the whole feature is
  following concepts rather than reading a wall of text.

**Evidence:** 
- E1, dwell-to-lock is the reference model — licenses the model and the double duty of the dwell
  timer, not the durations.
- E2, the lifecycle rules — licenses the ancestor stack and the depth cue, not the return grace.
- E3, overlap is what makes transit survivable — licenses cursor-anchored placement and the deletion
  of aimed safe areas and cursor-latch transit.
- E4, the model works on our own content — licenses the four durations as defaults on panel surfaces,
  not on the map.
- E5, the conversion inventory — the counts below are from the tree.

**Not claimed:**
- **This spec does not cover the language pass or the glossary wiring.** They are the other two strands
  of the same roadmap item and ride this refactor because it opens every tooltip surface once; what
  each definition *says* is `/game-copy`'s question, not this one. A skimmer would reasonably read
  "17 term triggers convert" as "17 definitions get written". It does not.
- It does not cover map hovers. Cursor-anchoring is specified partly because the map will need it
  later, but no map surface gains a term trigger here.
- It does not claim the four durations are right for every surface — only that they were tuned and
  accepted on the industry-panel content, and that they are settings-shaped if they turn out not to be.
- It does not decide whether pinning is discoverable enough. The control exists; whether players find
  it is a question for a later pass.
- It asserts nothing about the reference implementation's internals. Every claim about EU5 is an
  observation of its behaviour, not of its code.

### Behaviour

**States.** A tooltip is in exactly one of two states. *Filling* — the bar is advancing, the tooltip
trails the cursor, and the pointer passes through it as though it were not there. *Locked* — the bar
is full and hidden, the tooltip holds its position, and it can be entered and read. There is no third
state; pinning is a property of a locked tooltip, not a state of its own.

**The four durations**, all defaults, all tuned on the prototype (E4):

| Duration | Default | What it does |
|---|---|---|
| Open grace | 200 ms | The pointer must rest on a term this long before anything opens. Sweeping across a dense table opens nothing. |
| Dwell | 550 ms | How long the bar takes to fill. Until it does, the tooltip cannot be entered. |
| Return grace | 140 ms | How long a child survives after the pointer returns to its parent. |
| Leave grace | 90 ms | How long the whole stack survives after the pointer leaves all of it. |

Dwell is deliberately far below CK3's ~2 s: their hover targets are provinces, ours are single words,
and two seconds per word was punishing when tried (E1 Licenses, E4).

**Opening.** Resting on a term for the open grace opens its tooltip at the cursor, offset clear of the
pointer, clamped inside the viewport. Nothing avoids the parent — the overlap is the point (E3). The
tooltip enters *filling*, trails the cursor, and locks when the dwell completes.

**Depth.** A term's depth is one below the tooltip containing it; a term in a pinned tooltip, or in the
page, is depth zero. Opening at depth *d* closes everything from *d* upward and leaves everything below
untouched. This is the one thing the current module-level `openPopover` pointer
(`components/ui/popover.tsx:120`, claimed at `:130`, released at `:142`) cannot express, and replacing
it with an ancestor-aware stack is the substance of the change. The stack is naturally n-deep, so no
depth limit is specified.

**Returning to a parent** closes its children, but only after the return grace — without it the few
pixels between a term and its own child would count as a return and kill the child on the way to it
(N2).

**Leaving.** When the pointer is on neither a term nor a live tooltip, the whole stack closes after the
leave grace.

**Depth cue.** The newest three tooltips render at full opacity; the fourth-newest at 0.5 and anything
older at 0.28 (E2, "25-50% roughly"). Pinned tooltips are always full opacity.

**Pinning** detaches the whole open chain from the stack: it stops responding to the pointer lifecycle
entirely and survives until dismissed. A term inside a pinned tooltip is depth zero, so it starts a
fresh chain rather than extending the pinned one.

**Keyboard.** Not in the reference implementation, and not optional for us — the current `Popover`
already carries keyboard access and this must not drop it. Tab reaches every term; Enter opens its
tooltip already *locked*, anchored to the term rather than the cursor, with no dwell (a keyboard user
has already expressed intent, so there is nothing for a dwell to disambiguate); Escape closes the
innermost open tooltip and returns focus to its trigger.

**Which surfaces convert.** A surface becomes a popover when it describes **a thing in the game**; it
stays a `Tooltip` when it describes **a control**. This is an accessibility line, not a preference: a
tooltip's content is the control's `aria-describedby` description, announced with the control
(`components/ui/tooltip.tsx:8`), while a popover is a separate region a person can enter and read.
Converting control help would make its text unreachable to a screen reader at the moment it is needed;
leaving a term as a tooltip makes its content unenterable, which is the whole feature.

By that rule, from E5: the 17 `TooltipTriggerLabel` term triggers convert, as do the three
content-rich row-triggered bodies (`provision-block.tsx:19`, `logistics-panel.tsx:141`,
`industry-panel.tsx:726`). Control help stays: `form/checkbox-input.tsx`,
`form/radio-option-group.tsx`, `map/map-overlay-controls.tsx`, and `quick-add-button.tsx:24`.

**The existing five `Popover` consumers** (`alert-flyout`, `alert-run`, `alert-settings`,
`system-rings`, `tracker-row`) must come through the exclusivity change behaving as they do now. They
are single-level users; a stack of depth one behaves exactly as a single pointer did. The 53 cases in
`components/ui/__tests__/popover.test.tsx` are the regression surface.

### Hazard worksheet

Pure-UI change: rows 3 and 6, per the worksheet's own scope rule.

#### 3. A system you did not think about

| System | Interaction with this change | Reason if none |
|---|---|---|
| Events | None | Events reach the player through the alert surfaces, which are `Popover` consumers already (`alert-flyout.tsx`, `alert-run.tsx`). They gain nesting capability but no term triggers here, and their single-level behaviour must not change — named as a regression surface above. |
| Population + migration | None | `population-panel.tsx` holds 3 of the 17 converting triggers, so it is a consumer of the change, not a mechanic interacting with it. No world state is read or written. |
| Unrest / regime | None | No unrest quantity is read; unrest reaches these panels as already-computed readout values. |
| Industry + staffing | None | `industry-panel.tsx` holds 9 triggers and is the primary conversion surface, but it consumes the change. Nothing about staffing computation is touched. |
| Infrastructure decay | None | Decay appears as a glossary term to be defined, never as a value this feature computes or reads. |
| Directed logistics | None | `logistics-panel.tsx:141` is one converting surface; its data is unchanged. |
| Directed build / planner | None | `quick-add-button.tsx:24` is control help and deliberately does **not** convert, so the planner's surfaces are untouched. |
| Colonisation + founding manifest | None | No colonisation surface holds a term trigger today. |
| Treasury / purse | None | The top-bar stat popovers the owner deferred would have touched this; they are explicitly out of scope. |
| Factions + relations | None | No faction surface holds a term trigger today. |
| Save format (`World` shape) | None | Tooltip state is component state on the UI thread. Nothing is serialised, so no `World` field is added and the JSON-serialisability constraint is not engaged. |
| The harness's own metrics | None | `npm run simulate` drives `runWorldTick` and never mounts a component. No sim metric can observe this change, which is why gate 4's simulate quote does not apply to this PR. |

#### 6. Designing against an aggregate that moves for other reasons

| Metric | Read at which cohort | What else moves this number |
|---|---|---|
| None | — | This feature targets no measured aggregate. Its outcome is interaction quality, which is why the evidence above is a reference implementation and a prototype rather than a simulate run. The honest risk this row exists to catch — reading a number that moved for another reason — cannot arise, because no number is being read. The corresponding risk that *does* apply is a prototype passing on content that is not representative, addressed by building it on the real deposit table and real glossary definitions, including dense mid-sentence prose (E4). |

### Falsifiers

No `/brainstorm` ran on this strand, so there is no prior committed falsifier to move unedited. These
are authored here, and this note is the provenance.

- **F1 — the dwell does not guard against passing terms.** If, with dense highlighting, moving the
  pointer from a term to its own locked tooltip fires an intervening term's tooltip, then the dwell is
  not doing the second job E1 claims for it, and the model needs a separate transit guard after all.
  Checkable by hand on the industry panel once converted, and the failure the first prototype showed.
- **F2 — the return grace is doing harm. Run, and it survived.** The test was: if setting the return
  grace to 0 is indistinguishable in use from 140 ms, then N2 is a mechanism invented for a problem the
  overlap already solved and should be deleted. At 0 ms the child closes before it can be reached —
  owner, operating the prototype: "If i set it to 0, the child tooltip closes before I can even hover
  it". The grace is load-bearing, and the reason is mechanical: the child opens offset from the cursor,
  so reaching it means stepping off the term onto the parent's body for a few pixels, which is
  indistinguishable from a genuine return without a time window. The constant stays and this is the
  explanation it carries.
- **F3 — a five-deep chain is unreachable in the real panel.** The prototype's chains are five deep on
  a full-width page. If the real panel, docked over the map at its real width, cannot show three levels
  without the third being clamped to a screen edge and overlapping its own trigger, then cursor
  anchoring is insufficient there and placement needs a rule the reference implementation does not have.
- **F4 — the existing five consumers change behaviour.** If any of the 53 popover cases needs its
  expectation changed to pass, the stack is not a faithful generalisation of the pointer, and the
  change is a rewrite of shipped behaviour rather than an extension of it.

### Notes on what is ours, not observed

- **N1 — keyboard access.** Wholly ours. The reference implementation is pointer-only.
- **N2 — the return grace.** Ours, and confirmed necessary by F2. The owner observed that returning to
  a parent closes its child and that dismissal is "pretty instant […] maybe a tiny grace period"; taken
  literally, an instant return rule also fires during the few pixels between a term and its child. The
  reference implementation must therefore have either an overlap tight enough that those pixels never
  register or a grace of its own — we could not observe which, and 140 ms is ours.
- **N3 — the opacity thresholds.** 0.5 and 0.28 are a reading of "25-50% roughly" for the fourth and
  older, not an observed pair.

---

## Next stage

`/build-plan`. Spec review is skipped under its own rule: this is a pure-UI change — it adds no
processor, reads no shared constant, and touches no world state, as row 3 records line by line.
