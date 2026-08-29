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
| `TooltipTriggerLabel` term triggers | 10 | `system-astrography.tsx` (2), `industry-panel.tsx` (6), `population-panel.tsx` (1), `potential-yield-table.tsx` (1) — counted as `<TooltipTriggerLabel` opening tags. An earlier count of 17 came from grepping the bare name, which also matches each closing tag and the import line. |
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
| Return grace | 140 ms | How long a child survives after the pointer returns to its parent. **Fixed, not tunable** — it is our workaround for a mechanical artifact (N2), not observed behaviour, and a player setting for it would expose the workaround as a preference. Owner decision: "Let's just leave it fixed for now". |
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

By that rule, from E5: the 10 `TooltipTriggerLabel` term triggers convert, as do the two
content-rich row-triggered bodies (`provision-block.tsx:20`, `logistics-panel.tsx:142`). Control help
stays: `form/checkbox-input.tsx:38`, `form/radio-option-group.tsx:112`,
`map/map-overlay-controls.tsx:125`, `quick-add-button.tsx:25`, and `industry-panel.tsx:727`
(`LegendTooltip`).

`TooltipTrigger asChild` is not itself the tell. It marks a trigger whose shape is a row or a wrapper
rather than a text label, and it appears on both sides of the line — on the two content-rich bodies
that convert and on the control help that does not. The rule is applied to what the content
describes.

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

---

## Build plan

Spec review skipped under its own rule (pure UI). One branch, one PR, with a single check-in gate
after the first converted panel.

### Resolution — every measure the spec promises

| Measure | State | Producer |
|---|---|---|
| Open grace, 200 ms | new | Task 1 — `DWELL_OPEN_DELAY_MS` |
| Dwell, 550 ms | new | Task 2 — `DWELL_MS` |
| Return grace, 140 ms | new | Task 3 — `RETURN_GRACE_MS`, fixed, not a prop |
| Leave grace, 90 ms | new | Task 3 — `LEAVE_GRACE_MS` |
| Depth of a tooltip | new | Task 1 — the stack index from `usePopoverDepth()` |
| Opacity tiers, 1 / 0.5 / 0.28 | new | Task 3 — `DEPTH_OPACITY` |
| "Top three at full opacity" | new | Task 3 — `FULL_OPACITY_DEPTH = 3` |
| Existing hover-open delay, 300 ms | exists | `components/ui/popover.tsx:114` — unchanged; the five existing consumers keep it |
| Existing close grace, 150 ms | exists | `components/ui/popover.tsx:115` — unchanged, same reason |
| A term's definition body | new | Task 4 — `TERMS` record |
| The dotted-underline trigger affordance | exists | `components/ui/tooltip.tsx:30` (`triggerLabelStyles`, module-private) — Task 4 extracts it |
| The copper second-tier affordance | exists | `docs/active/design-system/theme.md:227` reserves copper for "glossary-backed concept links (the planned deep-tooltip system)" — Task 4 spends it |

The two existing constants are the reason the dwell model is **opt-in per popover** rather than a
replacement: the spec requires the five existing consumers to come through behaving as they do now,
and they are built on 300/150.

### Task 1 — replace the exclusivity pointer with an ancestor stack

Files: `components/ui/popover.tsx`, `components/ui/__tests__/popover.test.tsx`

Interface: `usePopoverDepth(): number` — a popover's index in the open stack, 0 for one with no open
ancestor. Internally the module-level `openPopover: (() => void) | null`
(`components/ui/popover.tsx:120`) and its `claimOpen`/`releaseOpen` pair (`:130`, `:142`) become a
stack of the same `closeSelf` closures; `claimOpen(closeSelf, depth)` closes every entry from `depth`
upward instead of the single incumbent. `takeoverInProgress` (`:128`) keeps its meaning and its role
in `CloseReason` (`:179`) — a takeover is now "an entry at or below my depth claimed", not "the one
incumbent claimed". A popover with no open ancestor is depth 0, which is the whole of today's
behaviour.

Proves:
- A popover opening at depth 0 while another depth-0 popover is open closes it — today's exclusivity,
  unchanged, and the vacuity check for the whole task.
- A popover opening at depth 1 leaves its depth-0 ancestor open.
- A second depth-1 popover opening closes the first depth-1 popover and still leaves depth 0 open.
- Closing a depth-0 popover closes its depth-1 descendant with it, rather than stranding it.
- A popover unmounting under a live pointer releases only its own stack entry and never truncates
  entries below it — the reference-guarded release at `:142` generalised, and the failure mode its
  own comment already names.
- `takeover` is recorded true for a popover closed by a claim at or below its depth, and false for
  one closed by Escape or a pointer leave — the flag the close-side focus decision reads.

Consumes: nothing.

Reuse: composes the existing `Popover` internals only. No `components/ui` piece is added.

### Task 2 — the dwell-to-lock mode

Files: `components/ui/popover.tsx`, `components/ui/__tests__/popover.test.tsx`

Interface: `PopoverProps` gains `dwell?: boolean` (default `false`, so every existing consumer is
untouched). With `dwell` set: `openDelay` is ignored in favour of `DWELL_OPEN_DELAY_MS = 200`; the
popover opens into a `filling` state, positioned at the pointer and following it, with pointer events
off; after `DWELL_MS = 550` it enters `locked`, stops following and takes pointer events. Context
gains `dwellState: "filling" | "locked" | null` (null when the mode is off) so `PopoverContent` can
render the bar and set its own pointer-events. Position while filling is set on the content element
directly rather than through Radix's anchor, since the anchor is the trigger and the spec anchors to
the cursor.

Proves:
- Sweeping the pointer across a trigger faster than the open grace opens nothing.
- A popover in `filling` does not receive the pointer — a pointer over its area still reports the
  element beneath it.
- A popover reaching `locked` receives the pointer and holds its position when the cursor moves on.
- Leaving the trigger before the dwell completes closes the popover and no `locked` state is ever
  reached.
- A `Popover` without `dwell` set opens on the existing 300 ms delay, never enters either state, and
  renders no bar — the regression arm for the five existing consumers.
- The dwell bar's fill duration equals `DWELL_MS`, so the bar cannot promise a lock at a different
  moment than the one that arrives.

Consumes: Task 1 (`usePopoverDepth` — a filling popover still claims its depth on open).

Reuse: `New: DwellBar — components/ui/popover.tsx`, an element of the popover rather than a
free-standing component. Searched for an existing time-fill indicator by behaviour ("progress",
"bar", "fill", "timer") across `components/ui`: `ProgressBar` (`components/ui/progress-bar.tsx`) is
the only candidate and does not fit — it is a labelled data readout that requires `label`, `value`
and `max`, renders a value/max label row, and exposes `role="progressbar"` with an `aria-valuenow`.
The dwell indicator has no data value, no label, and nothing worth announcing; reusing it would mean
inventing a label and a value and then suppressing the row that displays them.

### Task 3 — the stack lifecycle and the depth cue

Files: `components/ui/popover.tsx`, `components/ui/__tests__/popover.test.tsx`

Interface: `RETURN_GRACE_MS = 140` (module constant, deliberately not a prop — see the spec's
durations table), `LEAVE_GRACE_MS = 90`, `FULL_OPACITY_DEPTH = 3`, and
`DEPTH_OPACITY: readonly number[]` giving 1 for the newest three, then 0.5, then 0.28 for anything
older. The pointer entering a `locked` popover at depth *d* schedules the close of everything above
*d* after `RETURN_GRACE_MS`, cancelled by the pointer reaching any deeper popover. The pointer
resting on neither a trigger nor a live popover closes the whole stack after `LEAVE_GRACE_MS`.
Opacity is applied by depth-from-top, recomputed whenever the stack's length changes.

Proves:
- Moving from a term to its own child popover does not close that child, though the path crosses the
  parent — the behaviour the return grace exists for, and the one that failed at 0 ms.
- Resting on a parent for longer than the return grace does close its children.
- Re-entering a child within the return grace cancels the pending close.
- Leaving the whole stack closes every depth, not only the top.
- Re-entering any popover within the leave grace cancels the pending dismissal of all of them.
- The fourth-newest popover renders below full opacity while the newest three do not — the boundary
  at `FULL_OPACITY_DEPTH`, which an off-by-one would put in the wrong place without failing anything
  else.

Consumes: Tasks 1 and 2.

Reuse: composes Task 2's states. No `components/ui` piece is added.

### Task 4 — term definitions as data, and the term trigger

Files: `lib/glossary/terms.tsx` (new), `lib/glossary/__tests__/terms.test.tsx` (new),
`components/ui/tooltip.tsx`, `components/ui/term-label.tsx` (new),
`components/ui/__tests__/term-label.test.tsx` (new), `docs/active/design-system/theme.md`

Interface: `TermId` (a union of the defined term ids) and
`TERMS: Readonly<Record<TermId, { term: string; body: ReactNode }>>` in `lib/glossary/terms.tsx`,
holding the minimum set the industry panel's own chains need — realised yield, potential yield,
resource slot, worked, locked, body, archetype, quality band, resource, building. A definition body
may itself contain `<TermLabel>` children, which is what makes a chain. `TermLabel` in
`components/ui/term-label.tsx` takes `{ id: TermId; children?: ReactNode }` and renders the trigger
plus its `Popover` in `dwell` mode, defaulting its label to `TERMS[id].term`. The dotted-underline
affordance currently private to `components/ui/tooltip.tsx:30` (`triggerLabelStyles`) is exported so
both triggers share one definition; `TermLabel` renders it in the copper treatment `theme.md:227`
reserves for exactly this.

Proves:
- Every `TermId` in the union has an entry, and every entry's id is in the union — the two cannot
  drift apart silently.
- A definition body containing a `TermLabel` renders a working trigger, so a chain is possible at
  all; a body containing none renders a leaf that opens nothing further.
- A term whose body references itself, directly or through another term, opens without recursing at
  render time — the glossary contains a real cycle (`family` and `specialisation complex` define each
  other), so this is a live case and not a hypothetical.
- `TooltipTriggerLabel` renders exactly the decoration it does today after the style is extracted —
  the vacuity check on the extraction, which would otherwise silently restyle 17 existing triggers.
- `TermLabel` and `TooltipTriggerLabel` are distinguishable in the rendered output, since the design
  system assigns them different tiers.

Consumes: Task 2 (the `dwell` prop), Task 1 (depth).

Reuse: `triggerLabelStyles` (`components/ui/tooltip.tsx:30`) — read this session; a `tv()` slot with
a single `base` string, extracted rather than copied per the second-occurrence rule.
`Popover`/`PopoverTrigger`/`PopoverContent` (`components/ui/popover.tsx:256,436,539`) — props read
this session. `New: TermLabel` — searched for an existing "word that opens its own definition" by
behaviour ("term", "concept", "definition", "glossary") across `components/`, `lib/` and `client/`:
nothing exists, and no glossary data module exists either.

### Task 5 — keyboard access in the dwell mode

Files: `components/ui/popover.tsx`, `components/ui/term-label.tsx`,
`components/ui/__tests__/popover.test.tsx`

Interface: no new exported surface. In `dwell` mode, a keyboard open (Enter on the trigger, and the
existing `openViaFocus` path in `components/ui/popover.tsx`) skips both the open grace and the dwell,
entering `locked` immediately and anchoring to the trigger's own rect rather than the pointer. Escape
closes the innermost open popover and returns focus to its trigger, which is the existing close-side
focus decision (`CloseReason`, `components/ui/popover.tsx:179`) applied at the top of the stack
rather than to the single incumbent.

Proves:
- Enter on a term trigger opens its popover already locked and enterable, with no dwell elapsed.
- A keyboard-opened popover anchors to its trigger, not to wherever the pointer happens to be.
- Escape with a three-deep stack closes only the innermost, and a second Escape closes the next.
- Escape returns focus to the trigger of the popover it closed, not to the outermost trigger.
- A popover the pointer opened and the keyboard then entered still closes when the pointer leaves —
  the distinction `keyboardInsideRef` already draws in `components/ui/popover.tsx`, which the stack
  must not blur.

Consumes: Tasks 1, 2, 3, 4.

Reuse: composes the existing focus machinery — `focusIntoContent` (`components/ui/popover.tsx:166`),
`CloseReason` (`:179`), `suppressNextTriggerFocusRef`. No new piece.

### Task 6 — pinning a chain

Files: `components/ui/popover.tsx`, `components/ui/icons.tsx`,
`components/ui/__tests__/popover.test.tsx`

Kept deliberately, against the case for cutting it. After the dwell model landed, pinning's original
job — surviving the trip from a term to its own popover — was gone, and its only remaining job is
holding a chain while the pointer goes elsewhere, which no present surface needs. The owner kept it
for what is coming rather than what is here: "technically in the future its quite likely we will have
larger provincal style popovers, maybe that makes it worth keeping". Recorded so the same case for
cutting is not made again from the same evidence.

Interface: context gains `pinChain(): void`, exposed through a pin control `PopoverContent` renders
in `dwell` mode as an icon-only button — the owner's call, "we can just use a small pin icon instead
of text though so it doesnt take up a lot of visual space" — carrying an accessible name rather than
a visible label. Pinning detaches every entry of the current stack from the registry: the entries
stop responding to the return and leave graces, hold full opacity, and survive until dismissed. A
term inside a pinned popover reports depth 0 from `usePopoverDepth`, so it starts a fresh chain
rather than extending the pinned one.

Proves:
- A pinned chain survives the pointer leaving it entirely.
- A term inside a pinned popover opens at depth 0, leaving the pinned chain untouched.
- A fresh chain opened after pinning does not close the pinned one, at any depth.
- A pinned chain holds full opacity while an unpinned stack beside it fades by depth.
- Dismissing a pinned chain releases its registry entries, so a later chain is not offset by ghosts —
  the leak the reference-guarded release at `components/ui/popover.tsx:142` exists to prevent.
- The pin control is reachable and operable by its accessible name, not by its glyph — an icon-only
  button with no name is the failure this whole feature's accessibility line exists to avoid.

Consumes: Tasks 1, 2, 3.

Reuse: `Button` (`components/ui/button.tsx`) for the pin control — props read this session.
`components/ui/icons.tsx` is a single re-export line from `lucide-react`; the pin glyph joins it the
same way, so no icon is hand-drawn. No new component.

### Task 7 — convert the industry panel

Files: `components/system/industry-panel.tsx`,
`components/system/__tests__/industry-panel.test.tsx`

Interface: no new exported surface. The 6 `TooltipTriggerLabel` term triggers in
`components/system/industry-panel.tsx` (`:167`, `:511`, `:570`, `:614`, `:872`, `:1009`) become
`TermLabel`. **`LegendTooltip` (`:726`) does NOT convert** — it is an icon button carrying
`aria-label="Legend"`, control help by the spec's own rule, the same shape as the map overlay legend
already listed as staying a tooltip. An earlier draft of this plan wrongly listed it among the
content-rich row bodies. `YieldPopoverBody` (`components/system/industry-panel.tsx:176`)
keeps its shape and gains `TermLabel` markup on the terms it already names — combined yield, the body
archetypes, slots, the quality-band percentages — which is what makes the panel's first real chain.
The remaining `<Tooltip>` roots in the file that describe controls are left alone.

Proves:
- The yield cell's tooltip is reachable and readable, and a term inside it opens its own definition —
  the first end-to-end chain on a real panel.
- Passing the pointer over an intervening term on the way from a term to its own popover does not
  open the intervening term's popover — falsifier F1, run where it actually matters.
- Every trigger that converted is a term and every one left behind is control help, checked against
  the spec's rule rather than against the count.
- The panel renders with no popover open, so nothing about the conversion makes a tooltip appear
  unbidden.

Consumes: Tasks 1-6.

Reuse: `TermLabel` (Task 4), the `Popover` family. No new piece.

### Gate — owner smoke on the industry panel

Arms: Tasks 1-7 complete, `npm run build` clean, `npx vitest run` clean.

Reads: the industry panel in the browser at its real docked width, over the map. Falsifiers F1 and F3
are run here by hand, because jsdom has no layout and neither is observable in a Node test.

Merge condition: F1 shows no intervening term firing on the path from a term to its own popover; F3
shows a three-deep chain readable at the panel's real width without the third level being clamped to
a screen edge and covering its own trigger. If F3 fails, cursor anchoring is insufficient on a docked
panel and placement goes back to the spec — it is not patched here. The `docs/planned/glossary.md`
"Still open" item for housing occupancy in the Industry ledger is confirmed still booked at this
gate, since this is the PR that opens that panel.

### Task 8 — convert the remaining three panels

Files: `components/panels/system-astrography.tsx`,
`components/panels/__tests__/system-astrography.test.tsx`,
`components/system/population-panel.tsx`, `components/system/potential-yield-table.tsx`,
`components/system/provision-block.tsx`, `components/system/logistics-panel.tsx`

Interface: no new exported surface. The remaining 4 term triggers convert to `TermLabel`
(`system-astrography.tsx` 2, `population-panel.tsx` 1, `potential-yield-table.tsx` 1), and the two
row-triggered content-rich bodies become `dwell` popovers: `provision-block.tsx:20`, whose trigger is
a focusable `<tr>` describing that row's need, and `logistics-panel.tsx:142`, whose trigger is a
focusable wrapper round a `DivergingBarTrack`. Both use `TooltipTrigger asChild` because their
trigger is a row rather than a text label — `asChild` marks the trigger's shape, not whether the
content is control help, so the popover/tooltip rule is applied to what the content describes.
Deliberately untouched, all control help: `quick-add-button.tsx:25`, `form/checkbox-input.tsx:38`,
`form/radio-option-group.tsx:112`, `map/map-overlay-controls.tsx:125`, and
`industry-panel.tsx:727` (`LegendTooltip`).

Proves:
- Each converted panel opens a term's definition and, where the body names another term, a second
  level from it.
- The four deliberate non-conversions still render a plain tooltip whose text is the control's
  accessible description — the accessibility line the spec draws, asserted rather than assumed.
- A chain opened in one panel closes when the pointer leaves it, rather than surviving into another
  panel's hover.

Consumes: Tasks 1-7.

Reuse: `TermLabel` (Task 4). No new piece.

### Verification

- **`npm run build`** (`tsc && vite build`) — the build gate.
- **`npx vitest run`** — both projects; `components/**` renders in jsdom, so every task above lands in
  the `.test.tsx` project, `lib/glossary` included since its bodies are JSX.
- **No `npm run simulate` quote.** This PR adds no processor, reads no shared constant and touches no
  world state — hazard row 3 records that line by line — so it is not game logic under
  `feature-process.md` gate 4. Stating this is the claim the review checks, not an omission.
- **A browser smoke is required, not optional.** jsdom has no layout, and the two falsifiers this
  feature most needs (F1, F3) are both layout-and-pointer behaviours. The gate above is where it
  happens; the alignment class of bug this project has already shipped was invisible to every Node
  test.
- **F4 is read off the existing suite.** If any of the 53 cases in
  `components/ui/__tests__/popover.test.tsx` needs its expectation changed to pass, the stack is not a
  faithful generalisation of the pointer, and that is a finding rather than a fixup.

### Doc fold

Runs on this branch, before the final review.

- `docs/active/design-system/theme.md` — the copper second tier at `:227` is reserved for "the planned
  deep-tooltip system"; it ships here, so that line becomes a description of the shipped affordance,
  and the tooltip-affordance section at `:220` gains the term-trigger tier beside it. The rule at
  `:252` extends to cover `TermLabel`.
- `docs/planned/glossary.md` — the glossary stays planned, since this PR wires only the terms the
  industry chains need. Its "Still open" list keeps both items; neither ships here.
- `docs/SPEC.md` — the tooltip system becomes a described surface rather than a planned one.
- `docs/ROADMAP.md` — the nesting-and-pinning strand is done; the row itself stays for the language
  and glossary strands, with its next-step line rewritten to name them.
- No `docs/active/` doc is created. The behaviour lives in `components/ui/popover.tsx`'s own
  docstring, which already carries this file's design rationale and gains the dwell model.
- This working file is deleted on this PR.

### Not covered

- **The language pass and the full glossary wiring** — booked: `docs/ROADMAP.md` row 1 keeps its other
  two strands, and the fold above rewrites its next-step line to name them. Task 4 wires only the
  terms the industry panel's own chains need.
- **Map hovers** — dropped: no map surface has a term trigger today, and the spec's cursor anchoring
  is chosen partly so the map needs no different mechanism later. Reopening it needs a map surface
  that wants one, which does not exist.
- **Top-bar stat popovers** — dropped: the owner deferred them explicitly ("not now").
- **A player setting for any of the four durations** — dropped: the owner fixed the return grace as
  internal ("Let's just leave it fixed for now"), and the other three have no evidence that a player
  would want them different, only that we tuned them once.
- **Whether pinning is discoverable** — booked at the gate: the owner smoke is the first time anyone
  meets the pin control in a real panel, and the gate's reads include it. If it is not findable, that
  is a copy-and-affordance question for the language strand, which is already booked.
- **`buildOut`/`buildCount` on `FactionConstructionReadout`** — dropped here: they have no consumer,
  but they sit on no surface this PR touches, and the roadmap's full-construction-screen row is what
  would consume them.

### Net-new UI

For the owner, before `/implement-plan` starts:

1. **`TermLabel`** (`components/ui/term-label.tsx`) — the copper-underlined word that opens its own
   definition. This is the piece `theme.md:227` reserved copper for, and the one the prototype shows
   on every underlined word.
2. **The dwell bar** — an element inside `PopoverContent` in `dwell` mode, not a free-standing
   component. The hairline between the header and the content in the prototype.
3. **The pin control** — an icon-only `Button` in `PopoverContent`'s header in `dwell` mode, using a
   pin glyph re-exported from `lucide-react` through `components/ui/icons.tsx`. Composed rather than
   new, but it is a control players have not seen before, and it is the one piece the prototype shows
   as a text button rather than an icon.

Everything else composes existing pieces. The approved prototype shows exactly these three.
