"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ForwardedRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "./button";
import { opacityForDepth } from "./depth-opacity";
import { PinIcon } from "./icons";

/** The shape Radix's `virtualRef` anchor prop needs — an object whose `getBoundingClientRect`
 *  Popper reads on every reposition, real or virtual. */
interface Measurable {
  getBoundingClientRect(): DOMRect;
}

/**
 * The richer of the two hover surfaces — the second tier beside the plain
 * `Tooltip` (`components/ui/tooltip.tsx`). A tooltip's content is
 * unreachable by keyboard by design; this is built on Radix's Popover
 * instead, so the same trigger opens on hover, click AND keyboard focus,
 * and its content is a real focusable region rather than a description
 * string.
 *
 * Composition mirrors the tooltip wrapper:
 *   <Popover openDelay={300}>
 *     <PopoverTrigger>{control}</PopoverTrigger>
 *     <PopoverContent>{vitals table, unpin button, ...}</PopoverContent>
 *   </Popover>
 *
 * Behaviour Radix's Popover does not give for free, implemented here:
 * - Hover-to-open, after `openDelay`, without moving focus (a hover open
 *   must never steal focus off whatever the keyboard user was doing).
 * - A grace period on pointer-leave (of either trigger or content) before
 *   closing, so the pointer can cross the gap between them without the
 *   popover closing under it.
 * - Exclusivity by depth: opening a popover closes whatever was open at its own depth or deeper, via
 *   a module-level stack of `closeSelf` closures keyed by depth (`usePopoverDepth`). A popover with
 *   no open ancestor is depth 0, so two depth-0 popovers stay exactly as mutually exclusive as they
 *   always were; one nested inside another's content claims a deeper slot instead of contesting its
 *   ancestor's, so opening it leaves the ancestor open.
 * - `clickInert` on the root: takes the click out of the open/close gesture
 *   set entirely, for a consumer whose trigger's click already does
 *   something else (e.g. a Tracker row, which navigates on click). It calls
 *   `event.preventDefault()` before Radix's internal handler runs, which
 *   skips Radix's click *toggle* — so a click neither opens a closed popover
 *   nor closes an open one. Hover and keyboard-focus opens are untouched,
 *   since Radix only gates the click path on it.
 * - `pointerInert` on the root: the pointer is not an open/close gesture at
 *   all, for a consumer whose trigger hover already means something else (an
 *   alert chip's raises it clear of an overlapped run) or whose triggers
 *   sit close enough that sweeping across them would open each in turn.
 *   Both the hover-open timer and the pointer-leave close are suppressed —
 *   a gate on one alone would leave a popover that only click and keyboard
 *   can open but any pointer drift dismisses. Click and keyboard focus still
 *   open, and Escape, an outside click and the exclusivity registry still
 *   close, so nothing below changes.
 * - `dwell` on the root: the cursor-anchored dwell-to-lock mode the term/glossary popovers use
 *   instead of plain hover. Ignores `openDelay` in favour of the fixed `DWELL_OPEN_DELAY_MS`, and
 *   opens into a `filling` state — positioned at the pointer, following it, pointer events off —
 *   before locking after `DWELL_MS`: position freezes and the popover starts taking the pointer.
 *   A thin `DwellBar` renders across the top while filling and is gone once locked.
 *
 *   Placement while `filling`/`locked` is Radix's own: a `PopoverPrimitive.Anchor` given a
 *   `virtualRef` (a `{ getBoundingClientRect }` object rather than a real DOM node — Radix's
 *   supported way to anchor a popper to an arbitrary point) whose rect tracks the pointer, letting
 *   Radix's own placement, collision detection and edge-flipping run — not our own content element
 *   set its own `position`/`top`/`left`, which is what an earlier version of this mode did, and
 *   which fought Radix's real positioning: Radix applies its `transform` to a *wrapper* div one
 *   level above the content it portals, and a `position: fixed` element inside a transformed
 *   ancestor is positioned relative to that ancestor, not the viewport — which is why that earlier
 *   version rendered consistently offset from the cursor. `updatePositionStrategy="always"` while
 *   `filling` makes Radix re-read the anchor every animation frame (its documented mechanism for
 *   tracking a moving virtual point, the same one context menus use to follow the cursor);
 *   dropping back to the default `"optimized"` on lock stops the polling, and since nothing
 *   updates the virtual rect after that either, the position freezes — that is the entire
 *   mechanism behind "stops following". `cursorAnchored` (per-popover state, decided once at open
 *   time) is what renders the virtual `Anchor` at all: raised for a pointer-driven open, never
 *   raised for a keyboard open, so a keyboard-opened popover has no custom anchor in the tree at
 *   all and Radix falls back to its own default — anchoring `PopoverTrigger` to itself — exactly
 *   the "keyboard opens a dwell popover locked" bullet below already required. `dwellState` on the
 *   context is `null` whenever `dwell` is not set, which is how `PopoverContent` knows not to
 *   render the bar or touch pointer-events for the five existing hover-mode consumers.
 * - The dwell stack's own lifecycle, layered on top of `dwellState` rather than the plain
 *   `CLOSE_GRACE_MS` a hover-mode popover uses: the pointer entering a `locked` popover at depth
 *   *d* schedules the close of everything deeper than *d* after `RETURN_GRACE_MS`, replaced (not
 *   raced) by reaching any still-deeper popover — the workaround for a mechanical artifact, not
 *   observed behaviour: a child opens offset from the cursor, so the trip from a term to its own
 *   popover crosses the parent's body for a few pixels, indistinguishable from a genuine return
 *   without a time window. That enter is only
 *   half of it, and the rarer half: a nested popover's content renders INSIDE its parent's
 *   content, so returning from a child to its parent never leaves the parent's subtree and fires
 *   no `pointerenter` on it. The child's own `pointerleave` is the event that does arrive, so a
 *   `locked` popover at depth *d* > 0 schedules `closeFromDepth(d - 1)` on its own leave — closing
 *   itself and everything deeper. The enter path still covers a genuine DOM-boundary re-entry
 *   (returning from a sibling chain), and either one replaces the other's timer rather than racing
 *   it. Depth 0 is excluded: `closeFromDepth(-1)` is the close-everything sentinel, and leaving the
 *   outermost popover belongs to the leave grace below, which is the one that knows whether the
 *   pointer reached anything else in the stack. The pointer resting
 *   on neither a trigger nor a live `dwell` popover anywhere in the stack closes the whole stack
 *   after `LEAVE_GRACE_MS`. Both timers are module-level, like `openStack` itself: they govern the
 *   whole stack, not any one popover's own lifecycle, and a `dwell` popover never runs the plain
 *   `CLOSE_GRACE_MS` pointer-leave close at all — only the five existing non-`dwell` consumers do.
 * - The depth cue: `PopoverContent` renders at `opacityForDepth` (`components/ui/depth-opacity.ts`)
 *   of its distance from the top of the stack, recomputed whenever the stack's length changes via
 *   a small module-level subscription (`subscribeStackLength`) — `openStack` itself is deliberately
 *   not React state, so this is the one place a length change is broadcast to whatever renders off
 *   it. Harmless for a single-level stack: depth-from-top is always 0 there, which is full opacity.
 * - The keyboard enter/exit convention below.
 * - **Keyboard opens a `dwell` popover locked, not filling.** Enter on its trigger, and the trigger
 *   regaining focus (`openViaFocus`), skip both the open grace and the dwell entirely — `dwellState`
 *   goes straight to `locked` rather than through `filling` first. A keyboard user pressing Enter or
 *   landing on a trigger has already expressed intent unambiguously, so there is nothing left for the
 *   dwell to disambiguate (unlike a passing hover, which is why the dwell exists at all for the
 *   pointer). Because `dwellState` never becomes `filling` on this path, the cursor-anchored
 *   `fillingPosition` effect — which only ever runs while it is — never runs either, so the popover
 *   keeps whatever position Radix's own anchor-to-trigger placement gives it instead: `dwellPointerRef`
 *   is never read, however recently the pointer visited. Reaching an already-`filling` popover this way
 *   (Tab back onto a trigger whose popover a stray hover left mid-fill) finishes the dwell early rather
 *   than waiting out whatever remained of it.
 * - **Pinning.** `PopoverContent` renders an icon-only pin/unpin toggle (`components/ui/icons.tsx`'s
 *   `PinIcon`, via `Button`) once a `dwell` popover is `locked` — but only at the DEEPEST level
 *   currently showing one, never at every level of the chain at once. For a live (unpinned) chain
 *   that is whichever popover currently sits at the top of `openStack` (`depthFromTop === 0` below);
 *   for a pinned chain it is whichever entry was deepest AT THE INSTANT it was pinned (`pinnedIsDeepest`,
 *   set once by `pinStack` and never recomputed afterwards — a pinned chain's shape is frozen). The
 *   control follows the pointer down as the chain grows, so there is never a question of which level
 *   a click pins or unpins from.
 *
 *   `pinChain()` (on context, wired to the button's `onClick` while unpinned) detaches every entry
 *   currently in `openStack` — this popover's whole chain, ancestors and already-open descendants
 *   alike, not only the one the button was clicked on — from the registry in one go (`pinStack`): the
 *   array is emptied, notifying `subscribeStackLength`, moved to the module-level `pinnedChain` (so
 *   `unpinChain` below has something to reverse), and each detached entry's own `pinned` React state
 *   flips true. A `pinned` popover stops responding to the return and leave graces (every pointer
 *   handler above that touches `scheduleReturnClose` or the stack-hover count —
 *   `markStackEntered`/`markStackLeft`, which is what now calls `cancelLeaveClose`/`scheduleLeaveClose`
 *   — is gated on it, and pinning itself releases whatever contribution to that count the popover was
 *   still holding, captured first so `unpinChain` can put it back — see below), holds full opacity
 *   regardless of the live stack's length (`PopoverContent`'s own opacity calc short-circuits on it,
 *   since a detached popover's stale `depth` against the CURRENT stack's length would compute a
 *   meaningless number), and survives until dismissed — Escape and an outside click still reach it,
 *   since neither routes through this file's own machinery at all (Radix's own
 *   `DismissableLayer`/`FocusScope` per `Popover.Root`). A term inside a pinned popover reads depth 0
 *   from `usePopoverDepth` rather than one more than its pinned ancestor's, so it starts a fresh chain
 *   instead of extending the pinned one.
 *
 *   **Unpinning is not a request to close.** `unpinChain()` (wired to the same button once pinned) is
 *   `pinStack`'s exact inverse: it pushes every entry in `pinnedChain` back into `openStack`, in their
 *   original order, and flips each back to unpinned. Escape remains a way to close the chain, but it
 *   is no longer the ONLY way out of a pinned one — the button that pinned it un-pins it too, from the
 *   same place. If a fresh, unrelated chain has since claimed depth 0 (a pinned chain and a live one
 *   can coexist — see below), that rival is closed first, via the exact same "claim beats incumbent"
 *   path `claimOpen` already runs for any depth-0 contest (`closeRivalAt`, factored out of `claimOpen`
 *   so both callers share it rather than each reimplementing "close whatever is there first").
 *
 *   Unpinning has to restore each entry's `stackHoverCount` contribution, not just its `pinned` flag —
 *   otherwise the very next whole-stack leave grace is wrong. The pointer is, in the ordinary case,
 *   still resting on the content the unpin button lives in at the instant it is clicked, but pinning
 *   already zeroed that popover's contribution to the shared count and a pinned popover never touches
 *   the count again while pinned — so nothing re-increments it on the way back in, and no DOM
 *   `pointerenter` will ever fire to do it either: the pointer never crosses a boundary, it was
 *   already there. `setPinned(true)` captures each entry's own outstanding contribution
 *   (`pinnedHoverRef`, 0 or 1 same as `stackHoverLocalRef` itself) before releasing it; `unmarkPinned`
 *   reads that capture back and calls `noteStackEnter()` once for each unit, putting `stackHoverCount`
 *   back exactly where it would be had the popover never been detached at all. Skipped for the
 *   ordinary close-time reset (`setOpen`'s `dwell` branch also calls `setPinned(false)` on every
 *   close, pinned or not) — that path clears the capture without restoring anything, since a closing
 *   popover has no live pointer contact left to account for.
 *
 *   Detaching mid-grace matters: `scheduleReturnClose`/`scheduleLeaveClose` read `openStack` LIVE
 *   when they fire, so `pinStack` cancels both before emptying the array — otherwise a grace already
 *   pending for the chain being pinned would fire after the array is emptied (or reused by a fresh
 *   chain) and act on whatever now occupies those depths instead of the popovers it was scheduled
 *   for.
 *
 *   The reverse direction needed its own fix: every popover's unmount used to clear both timers
 *   unconditionally, which was safe only because at most one chain could ever be live — clearing on
 *   any unmount was always safe-to-over-apply when there was nothing else pending to lose. Pinning
 *   breaks that: a pinned chain and a fresh unpinned chain can be live at once, and the pinned one's
 *   eventual dismissal — its own root closing, tearing down every popover nested in its content —
 *   unmounts every popover in it at once, each running that same cleanup. A popover that was
 *   `pinned` before it unmounts never touches these timers again once pinned (see the pointer
 *   handlers above), so it never owns whatever is pending on them; the unmount cleanup below skips
 *   the clear for exactly that popover, leaving a still-live, unrelated chain's pending grace to fire
 *   as scheduled.
 *
 * ## The keyboard convention — every popover in the game obeys it
 *
 * Opening and entering are two separate steps, because a popover describes the
 * thing its trigger already is: the trigger is where the user is, and a
 * popover that grabs focus takes them somewhere they did not ask to go. Popovers
 * are portalled to the end of the document, so a grabbed focus also puts
 * every element after the trigger behind the popover in tab order — in a list
 * of triggers (the Tracker's rows) that makes the list unwalkable.
 *
 * - **Open never moves focus.** Hover, click and keyboard focus all leave
 *   focus on the trigger.
 * - **ArrowDown on the trigger enters the popover**, opening it first if it is
 *   closed. Focus lands on the popover's first focusable element, or on the
 *   content container itself when the popover holds nothing focusable, so the
 *   content is still reachable by a screen reader. The key is consumed, so
 *   the page does not scroll as well.
 * - **Escape closes the popover and returns focus to the trigger** — the exit,
 *   and the counterpart of ArrowDown.
 * - **Tab and Shift+Tab cycle within an entered popover** rather than leaving
 *   it for the end-of-document void behind it. This is Radix's `FocusScope`
 *   in `loop` mode, which its Popover always enables; nothing here
 *   reimplements it, but it is half of why Escape is a way out and not the
 *   only thing between the user and a dead end.
 * - **A popover entered by keyboard is keyboard-driven from then on**, even if
 *   a hover opened it: `keyboardInsideRef` is raised by `enterPopover` and is
 *   what both the pointer-leave grace period and the close-side focus
 *   return read, so neither depends on how the popover was opened.
 *
 * A popover whose content itself contains a popover trigger inherits all of
 * this recursively, one level per ArrowDown and one per Escape, including
 * the exclusivity registry: opening a nested popover claims its own depth
 * in the stack (`usePopoverDepth`) rather than the one its ancestor holds,
 * so the ancestor stays open and only entries at or above the nested
 * popover's own depth are displaced.
 *
 * Escape-to-close is Radix's own default (non-modal) Popover behaviour and
 * is not reimplemented here. Returning focus to the trigger on close is
 * Radix's too, and `PopoverContent` lets it happen in exactly one case: a
 * popover the keyboard had entered, closing for any reason other than another
 * popover taking over. Every other close suppresses it, because a popover that
 * never held focus has nothing to hand back and handing it back anyway
 * *moves* the user — the focus lands on the trigger and a `focusin` outside
 * whichever popover has just taken over is all Radix needs to dismiss that one.
 *
 * **The limitation that remains:** a popover the keyboard has entered, closed
 * by another popover taking over — the pointer wandering onto the next row
 * while the keyboard sits inside this one — hands focus back to nothing.
 * Returning it to the trigger is exactly the destructive case above, so
 * focus falls to the document body instead, and the next Tab after that
 * mixed pointer-and-keyboard sequence restarts from the top of the
 * document. Only the takeover path is affected; Escape, an outside click
 * and a pointer-leave close all still land the user where they should be.
 */

const DEFAULT_OPEN_DELAY_MS = 300;
const CLOSE_GRACE_MS = 150;
/** Hover-open delay for a `dwell` popover — replaces `openDelay` entirely, since dwell mode's four
 *  durations (this, `DWELL_MS`, `RETURN_GRACE_MS`, `LEAVE_GRACE_MS`) are tuned as a unit rather
 *  than independently per consumer. */
export const DWELL_OPEN_DELAY_MS = 200;
/** How long a `dwell` popover spends `filling` before it `locked`s — the single constant that
 *  drives both the lock timer below and the `DwellBar`'s fill duration, so the two can never
 *  promise a lock at different moments. */
export const DWELL_MS = 550;
/** How long a locked popover survives once the pointer returns to an ancestor — see the docblock's
 *  "dwell stack's own lifecycle" bullet for why it exists. Fixed as a module constant rather than a
 *  prop: the owner's call, "Let's just leave it fixed for now" — a player setting would expose a
 *  workaround for a mechanical artifact as though it were a tunable preference. */
export const RETURN_GRACE_MS = 140;
/** How long the whole open stack survives once the pointer rests on neither a trigger nor a live
 *  `dwell` popover anywhere in it. */
export const LEAVE_GRACE_MS = 90;
/** Vertical clearance between the cursor and a cursor-anchored `dwell` popover's near edge — only
 *  for a pointer-driven open (`cursorAnchored`; a keyboard-opened one anchors to the trigger
 *  instead and uses the ordinary `sideOffset` every other popover does). Applied as Radix's own
 *  `sideOffset` (the gap between the anchor and the content along `side`, `"bottom"` here), so with
 *  the popover staying horizontally CENTRED on the cursor (`align` is left at `popover.align`,
 *  never overridden — a first version that switched it to `"start"` moved the popover right by
 *  half its own width, which read as the positioning regressing all over again) its top edge sits
 *  clear of the cursor rather than under it. Floating-ui's `offset` middleware (which Radix's
 *  `PopperContent` runs `flip` after) re-reads the CURRENT placement every time it runs, including
 *  after a flip, so this stays a gap on the outside of whichever side the popover actually lands
 *  on — a popover flipped above the cursor sits `DWELL_CURSOR_CLEARANCE_PX` above it, not under it,
 *  the same way `sideOffset` already behaves correctly on flip for every trigger-anchored popover
 *  in this file. */
export const DWELL_CURSOR_CLEARANCE_PX = 12;

/** One popover's registry entry: `closeSelf` is what exclusivity has always compared and called;
 *  `markPinned`/`unmarkPinned` are the same kind of stable-identity closures, added for pinning — the
 *  one way the registry can tell a popover to detach itself (or reattach) without the registry
 *  needing to know anything about React state itself. `markPinned` takes whether THIS entry was the
 *  deepest in the chain at the instant of pinning — what `PopoverContent` uses to decide whether it,
 *  and not some shallower ancestor also carrying `pinned: true`, renders the unpin control. */
interface StackEntry {
  closeSelf: () => void;
  markPinned: (isDeepest: boolean) => void;
  unmarkPinned: () => void;
}

// Module-level "which popovers are open" stack, indexed by depth
// (`usePopoverDepth`). Not React state — it is only ever read at the moment
// a popover opens or closes. Nothing renders off it. A popover with no open
// ancestor claims index 0, exactly the single incumbent the old bare
// pointer held; a popover nested inside another's content claims the next
// index instead of contesting its ancestor's, so opening it displaces only
// entries at its own depth or deeper.
let openStack: Array<StackEntry> = [];

// True only for the instants `claimOpen` spends closing whatever it
// displaces at a depth — the incumbent already there, and, via
// `releaseOpen`'s own cascade, every descendant it was holding above that
// depth. Each popover being closed runs its own `setOpen(false)` inside
// that call, synchronously, which is the one moment it can tell "a claim at
// or below my depth took over" apart from every other reason it might be
// closing — and the difference decides whether it hands focus back to its
// trigger, because a focus landing outside the incoming popover dismisses
// it on sight.
let takeoverInProgress = false;

/**
 * Closes whatever currently holds `depth` in the registry, if it isn't `entry` itself — the "a new
 * claim beats an incumbent" rule both `claimOpen` (a fresh open contesting a live depth) and
 * `unpinChain` (re-attaching a pinned chain that might find depth 0 occupied by a rival that opened
 * in the meantime) need, factored out once there were two callers rather than left as a second copy.
 */
function closeRivalAt(depth: number, entry: StackEntry) {
  const incumbent = openStack[depth];
  if (incumbent && incumbent.closeSelf !== entry.closeSelf) {
    takeoverInProgress = true;
    try {
      // Closes the incumbent. Its own `releaseOpen` call below cascades to
      // close everything it was holding above `depth` too, so a claim at
      // depth d never strands a depth d+1 descendant.
      incumbent.closeSelf();
    } finally {
      takeoverInProgress = false;
    }
  }
}

function claimOpen(entry: StackEntry, depth: number) {
  closeRivalAt(depth, entry);
  openStack[depth] = entry;
  openStack.length = depth + 1;
  notifyStackLengthChange();
}

function releaseOpen(closeSelf: () => void) {
  const index = openStack.findIndex((entry) => entry.closeSelf === closeSelf);
  // Reference-guarded: a popover that never claimed its depth, or was
  // already displaced from it, must not touch the stack — the unmount
  // cleanup below exists entirely to lean on this guard, so it never blanks
  // a claim another popover now holds. A pinned popover's own close reaches
  // here too (unconditionally — pinning changes nothing about this call) and
  // is exactly the case this guard also covers: pinning already removed its
  // entry, so this is a no-op rather than a blank of whatever claimed the
  // depth after it.
  if (index === -1) return;
  const descendants = openStack.slice(index + 1);
  openStack.length = index;
  notifyStackLengthChange();
  // Deepest first: each closes itself, and the `releaseOpen` re-entry that
  // triggers is now a no-op — the truncation above already dropped it — so
  // this single pass closes every depth above `index` in one go, however
  // many levels deep, rather than stranding a descendant when its ancestor
  // closes. Each of those re-entrant calls finds `index === -1` and returns
  // before it would call `notifyStackLengthChange()` again, so a multi-level
  // cascade still notifies exactly once.
  for (let i = descendants.length - 1; i >= 0; i--) {
    descendants[i].closeSelf();
  }
}

/**
 * Pinning: detaches every entry currently in the stack from the registry in one go — the array is
 * emptied and every entry's own `markPinned` is run, flipping each popover's `pinned` React state.
 * Cancels any pending return/leave grace before doing so: both timers read `openStack` LIVE when
 * they fire (`closeFromDepth`), so a grace scheduled for the chain being pinned, left to fire after
 * the array is emptied (or reused by a fresh chain), would act on whatever now occupies those
 * depths instead of the popovers it was actually scheduled for.
 *
 * Two things guard a pinned popover against the pointer-close paths below, and they cover two
 * different windows rather than duplicating each other. Emptying `openStack` above takes effect the
 * instant this function runs, but only for as long as nothing else claims those depths — a fresh
 * chain opening afterward repopulates it, and the array can no longer answer for entries that are no
 * longer in it. `markPinned` flips `pinnedRef.current` (read by the unmount cleanup) the same
 * instant, but the `pinned` value every pointer handler closes over is React state, which does not
 * take effect until the next render commits — so in the gap between this call returning and that
 * render landing, those handlers are still reading `pinned: false` for an entry this function just
 * detached. The empty array is what protects a pinned entry in that gap; the `pinned` flag is what
 * protects it from then on, once something else may have refilled the array. Neither alone covers
 * both windows.
 */
function pinStack() {
  const entries = openStack;
  openStack = [];
  pinnedChain = entries;
  cancelReturnClose();
  cancelLeaveClose();
  notifyStackLengthChange();
  const deepestIndex = entries.length - 1;
  entries.forEach((entry, i) => entry.markPinned(i === deepestIndex));
}

// The most recently pinned chain, in original depth order — empty whenever nothing is pinned.
// `unpinChain`'s only input; overwritten (not appended to) by the NEXT `pinStack` call, since only
// one chain has ever been detachable at a time (pinning a second chain while a first is still pinned
// is not a flow the trigger — one button per currently-open chain — can even reach).
let pinnedChain: Array<StackEntry> = [];

/**
 * `pinStack`'s exact inverse: re-attaches every entry in `pinnedChain` to `openStack`, in their
 * original order, and flips each back to unpinned. A no-op if nothing is pinned (the button that
 * calls this only exists while something is).
 *
 * A fresh, unpinned chain may have claimed depth 0 in the meantime — pinning and unpinning are both
 * player-paced, and nothing stops a new hover starting a chain of its own while this one sat detached
 * — so whatever now holds depth 0 is closed first via `closeRivalAt`, the exact same "claim beats
 * incumbent" rule `claimOpen` already applies to any depth-0 contest.
 */
function unpinChain() {
  const entries = pinnedChain;
  if (entries.length === 0) return;
  pinnedChain = [];
  closeRivalAt(0, entries[0]);
  openStack = entries.slice();
  notifyStackLengthChange();
  for (const entry of entries) entry.unmarkPinned();
}

// Reactive mirror of `openStack.length`. The stack itself is deliberately not React state (see its
// own comment above) — read only at the moment a popover opens or closes — so this is the one place
// a change to it is broadcast to whatever is rendering off it (the depth-cue opacity below).
const stackLengthListeners = new Set<() => void>();

function notifyStackLengthChange() {
  for (const listener of stackLengthListeners) listener();
}

function subscribeStackLength(listener: () => void): () => void {
  stackLengthListeners.add(listener);
  return () => stackLengthListeners.delete(listener);
}

function getStackLength(): number {
  return openStack.length;
}

// The dwell stack's own lifecycle timers — module-level like `openStack` itself, because the return
// and leave graces govern the WHOLE stack rather than any one popover: reaching a still-deeper
// popover has to be able to replace a grace an ancestor just started, and leaving the entire stack
// has to close every depth, not only the one the pointer happened to leave last.
let returnCloseTimer: ReturnType<typeof setTimeout> | null = null;
let leaveCloseTimer: ReturnType<typeof setTimeout> | null = null;

function cancelReturnClose() {
  if (returnCloseTimer !== null) {
    clearTimeout(returnCloseTimer);
    returnCloseTimer = null;
  }
}

function cancelLeaveClose() {
  if (leaveCloseTimer !== null) {
    clearTimeout(leaveCloseTimer);
    leaveCloseTimer = null;
  }
}

/**
 * Closes everything deeper than `depth` (or the whole stack, for `depth === -1`), by closing only
 * the immediate entry above it — `releaseOpen`'s own cascade, triggered from that popover's
 * `setOpen(false)`, does the rest. Reads `openStack` live at call time rather than a depth captured
 * when the timer was scheduled, so a stack that has already changed shape by the time the timer
 * fires is acted on as it now is, not as it was.
 */
function closeFromDepth(depth: number) {
  const closeDeepest = openStack[depth + 1];
  closeDeepest?.closeSelf();
}

/**
 * The pointer entering a `locked` popover at `depth`: schedules the close of every popover deeper
 * than it once `RETURN_GRACE_MS` passes with the pointer resting there. Replaces whatever grace was
 * already pending rather than racing it — reaching a still-deeper popover calls this again with its
 * own (deeper) depth, which cancels-and-reschedules a close that would otherwise have removed it.
 */
function scheduleReturnClose(depth: number) {
  cancelReturnClose();
  returnCloseTimer = setTimeout(() => {
    returnCloseTimer = null;
    closeFromDepth(depth);
  }, RETURN_GRACE_MS);
}

/**
 * The pointer resting on neither a trigger nor a live `dwell` popover: schedules the whole stack's
 * close after `LEAVE_GRACE_MS`, cancelled by the pointer reaching any trigger or locked popover
 * belonging to a `dwell` popover anywhere in it.
 */
function scheduleLeaveClose() {
  cancelLeaveClose();
  leaveCloseTimer = setTimeout(() => {
    leaveCloseTimer = null;
    closeFromDepth(-1);
  }, LEAVE_GRACE_MS);
}

// How many of the dwell stack's own tracked pointer regions (any popover's trigger, or a LOCKED
// popover's own content) the pointer is currently over. Not a set of which ones — just a live
// count — since more than one such region ever reporting "entered" at once only happens for the
// duration of a genuine transit between two of them, never a rest.
//
// This is what `noteStackEnter`/`noteStackLeave` (below) use to decide whether the whole-stack
// leave grace should actually arm: only on the transition to zero, rather than unconditionally on
// every leave the way a bare schedule-on-every-leave, cancel-on-every-enter pair would. That
// distinction fixes a real ordering bug: a nested popover's own TRIGGER sits inside its ancestor's
// CONTENT — reaching the ancestor for a second look at it, from the child, plausibly leaves the
// child's trigger's bounds a beat AFTER the ancestor's content has already been entered, not
// before. Schedule-on-every-leave, cancel-on-every-enter would let that late leave re-arm a
// whole-stack close with nothing left to cancel it, closing the ancestor too — the transit
// workaround `RETURN_GRACE_MS` exists for on the way IN has no counterpart on the way back OUT.
// Counting makes the arm/disarm decision depend on whether ANYTHING is currently entered, not on
// which of two racing events happened last.
let stackHoverCount = 0;

/** A tracked region entered: always cancels any pending whole-stack close, matching a real
 *  cursor's cursor arriving somewhere in the stack regardless of the count's own value. */
function noteStackEnter() {
  stackHoverCount++;
  cancelLeaveClose();
}

/** A tracked region left: only arms the whole-stack close grace once NOTHING in the stack is
 *  entered any more — the count reaching zero, not merely this one region losing the pointer. */
function noteStackLeave() {
  stackHoverCount = Math.max(0, stackHoverCount - 1);
  if (stackHoverCount === 0) scheduleLeaveClose();
}

/** Releases whatever outstanding contribution to `stackHoverCount` a popover is carrying, without
 *  arming the leave grace even if that brings the count to zero — used only where a popover stops
 *  being able to balance its own enters and leaves (unmounting mid-hover, or being pinned, both
 *  below): "quietly correct the accounting" is the safe direction here, the same one the timer
 *  clearing elsewhere in this file already uses — leaving something open a little longer is fine,
 *  closing something that shouldn't is not. */
function releaseStackHover(count: number) {
  stackHoverCount = Math.max(0, stackHoverCount - count);
}

// Focusable-in-a-popover selector. Deliberately attribute-based (`:not([disabled])` rather than
// `:not(:disabled)`) so it reads the same in every DOM implementation the tests run in.
const FOCUSABLE_IN_POPOVER = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The one way focus ever gets into a popover — both the "open it, then enter" and the "already open,
 * enter" paths run through here, so entering cannot mean two different things depending on what
 * the popover's state was.
 *
 * A popover with nothing focusable inside still has to be reachable, or its content is invisible to a
 * screen reader driven by the keyboard; focus falls back to the content container, which Radix's
 * `FocusScope` gives a `tabIndex` of -1 (programmatically focusable, never in the tab order).
 */
function focusIntoContent(content: HTMLElement | null) {
  const first = content?.querySelector<HTMLElement>(FOCUSABLE_IN_POPOVER);
  (first ?? content)?.focus();
}

function composeHandlers<E>(
  ...handlers: Array<((event: E) => void) | undefined>
): (event: E) => void {
  return (event) => {
    for (const handler of handlers) handler?.(event);
  };
}

/** What the close-side focus decision needs to know about the close that is already in progress,
 *  captured the moment it starts because `onCloseAutoFocus` is dispatched a beat later, by which
 *  time neither fact is still readable. */
interface CloseReason {
  /** The keyboard had been driven into this popover — the only case where there is focus to hand back. */
  entered: boolean;
  /** A claim at or below this popover's own depth took over the stack; this one is closing to make
   *  room for it — whether it was the claim's direct incumbent or a descendant swept up in the
   *  cascade that claim triggered. */
  takeover: boolean;
}

interface PopoverContextValue {
  open: boolean;
  side: PopoverPrimitive.PopoverContentProps["side"];
  align: PopoverPrimitive.PopoverContentProps["align"];
  clickInert: boolean;
  /** This popover's own index in the open stack — 0 for one with no open ancestor, one more than
   *  the enclosing `Popover`'s own depth otherwise. What a nested popover reads off this (via
   *  `usePopoverDepth`) to compute its own. */
  depth: number;
  /** Whether this popover was created with `dwell` set — read independently of `dwellState`, which
   *  is `null` whenever the popover is closed even in `dwell` mode. `PopoverTrigger` needs this at
   *  moments `dwellState` can't answer: a `dwell` trigger still counts as "resting on the stack" for
   *  the leave grace before its own popover has opened at all. */
  dwell: boolean;
  /** `null` when `dwell` is not set on this popover — the mode is off and `PopoverContent`
   *  renders no bar and leaves pointer-events alone. `"filling"` while the lock timer is running,
   *  `"locked"` once it has fired. */
  dwellState: "filling" | "locked" | null;
  /** The most recent pointer position over the trigger, written by `PopoverTrigger`. What
   *  `setOpen` seeds the cursor-anchor's own live position ref from the instant a `dwell` popover
   *  opens by pointer, before the document-level `pointermove` tracking effect has run even once. */
  dwellPointerRef: MutableRefObject<{ x: number; y: number } | null>;
  /** The trigger's own DOM node, written by `PopoverTrigger` as it mounts/unmounts. What the
   *  cursor-anchor's virtual `getBoundingClientRect` falls back to reading for a keyboard-opened
   *  `dwell` popover. */
  triggerRef: MutableRefObject<HTMLElement | null>;
  /** Whether THIS popover's current open is anchored to the cursor — raised for a pointer-driven
   *  open, left false for a keyboard one. `PopoverContent` reads it only to record, as real DOM
   *  state, which anchor mode is actually live (`data-dwell-anchor`) — the placement decision
   *  itself is made by what `dwellAnchorVirtualRef`'s `getBoundingClientRect` reports, which this
   *  flag (via its ref mirror) drives. */
  cursorAnchored: boolean;
  /** Written by the root as the popover closes, read by `PopoverContent`'s close-side focus
   *  handling. The live flags behind it stay private to the root — this is the one thing the
   *  content needs off them, and only after the decision has already been made. */
  closeReasonRef: MutableRefObject<CloseReason>;
  suppressNextTriggerFocusRef: MutableRefObject<boolean>;
  /** The content element while the popover is open, null while it is closed — the target the
   *  trigger's ArrowDown focuses into. Written by `PopoverContent`. */
  contentRef: MutableRefObject<HTMLDivElement | null>;
  /** An enter asked for before the content existed: `enterPopover` raises it, the content lowers it
   *  as it mounts and takes the focus. */
  pendingEnterRef: MutableRefObject<boolean>;
  /** Whether pinning has detached this popover from the registry — `false` for the five existing
   *  (non-`dwell`) consumers for their whole lifetime, since nothing ever calls `pinChain` for them.
   *  Once `true`: this popover stops responding to the return and leave graces, holds full opacity
   *  regardless of the live stack's length, and a nested popover reads its own depth as 0 rather
   *  than one more than this one's (`usePopoverDepth`). */
  pinned: boolean;
  /** Whether THIS popover was the deepest entry in its chain at the instant it was pinned — decided
   *  once by `pinStack` and never recomputed afterwards, since a pinned chain's shape is frozen.
   *  Meaningless while `pinned` is false; `PopoverContent` only reads it gated on `pinned` being
   *  true, alongside `depthFromTop === 0` for the live (unpinned) case. Together they are what limits
   *  the pin/unpin control to a single level of the chain — the one the pointer most recently reached
   *  — rather than rendering one per open level. */
  pinnedIsDeepest: boolean;
  /** Detaches every entry currently in the open stack (this popover's whole chain, ancestors and
   *  already-open descendants alike) from the registry in one go. Exposed so `PopoverContent` can
   *  wire it to the pin control it renders in `dwell` mode. */
  pinChain: () => void;
  /** `pinChain`'s exact inverse — re-attaches the most recently pinned chain and flips every entry
   *  back to unpinned. What the SAME control calls once `pinned` is true, so unpinning never requires
   *  Escape. */
  unpinChain: () => void;
  /** A tracked region of THIS popover (its trigger or its own locked content) entered/left by the
   *  pointer — what `PopoverTrigger` and `PopoverContent` call instead of the module-level
   *  `cancelLeaveClose`/`scheduleLeaveClose` directly, so the whole-stack leave grace arms only
   *  once NOTHING in the stack is entered, not on whichever of two racing leave/enter events last
   *  happened to fire (see `noteStackEnter`/`noteStackLeave`'s own comments). */
  markStackEntered: () => void;
  markStackLeft: () => void;
  scheduleOpen: () => void;
  cancelScheduledOpen: () => void;
  openViaFocus: () => void;
  enterPopover: () => void;
  scheduleClose: () => void;
  cancelScheduledClose: () => void;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext(component: string): PopoverContextValue {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error(`${component} must be rendered inside <Popover>.`);
  }
  return context;
}

/**
 * A popover's own index in the open stack: 0 for one with no open ancestor, one more than the
 * enclosing `Popover`'s own depth otherwise. A deliberately non-throwing read — `usePopoverContext`
 * throws outside a `Popover`, which is right for `PopoverTrigger`/`PopoverContent` but wrong here: a
 * popover computing its OWN depth reads its ANCESTOR's context, which is absent for the ordinary
 * case of no ancestor at all, and absent is exactly what makes it depth 0.
 *
 * An ambient popover that is `pinned` reports 0 rather than one more than its own depth: pinning
 * detaches the whole chain from the registry, so a term inside it is starting a fresh chain of its
 * own, not extending the one that was just pinned.
 */
export function usePopoverDepth(): number {
  const ambient = useContext(PopoverContext);
  if (!ambient) return 0;
  return ambient.pinned ? 0 : ambient.depth + 1;
}

export interface PopoverProps {
  /** Hover-open delay in ms. Click and keyboard focus ignore this. */
  openDelay?: number;
  side?: PopoverPrimitive.PopoverContentProps["side"];
  align?: PopoverPrimitive.PopoverContentProps["align"];
  /**
   * Takes the click out of the open/close gesture set entirely. Set when the trigger's click
   * already has a job (e.g. a Tracker row navigates on click) so the same gesture doesn't also
   * work the popover.
   *
   * Symmetric, and named for the gesture rather than for opening, for the same reason
   * `pointerInert` below is: what it suppresses is Radix's built-in click *toggle*, so a click
   * neither opens a closed popover nor closes an open one — a hover-opened card stays up while the
   * click does its own job. Hover-open, keyboard-focus-open, Escape, an outside click and the
   * exclusivity registry are all unaffected.
   */
  clickInert?: boolean;
  /**
   * Takes the pointer out of the open/close gesture set entirely — the hover-open timer AND the
   * pointer-leave close. Set when the trigger's hover already means something else — an alert chip's
   * does, raising it clear of the overlapped run — or when triggers sit close enough together that
   * sweeping the pointer across them would open one after another.
   *
   * Deliberately symmetric, and named for the pointer rather than for opening: gating only the open
   * path leaves a popover a click opens and an unrelated pointer movement dismisses 150ms later,
   * which is worse than either whole behaviour. Click-open and keyboard-focus-open are unaffected,
   * and Escape, an outside click and the exclusivity registry still close it, so the popover stays
   * reachable and dismissable by every route that is not the pointer drifting.
   */
  pointerInert?: boolean;
  /**
   * The cursor-anchored dwell-to-lock mode (see the docblock above). `openDelay` is ignored in
   * favour of the fixed `DWELL_OPEN_DELAY_MS` when set. Defaults to `false`, so every existing
   * hover-mode consumer is untouched.
   */
  dwell?: boolean;
  children: ReactNode;
}

export function Popover({
  openDelay = DEFAULT_OPEN_DELAY_MS,
  side = "bottom",
  align = "center",
  clickInert = false,
  pointerInert = false,
  dwell = false,
  children,
}: PopoverProps) {
  // This popover's own slot in the exclusivity stack — computed once per render from the ANCESTOR's
  // context (see `usePopoverDepth`), not from the context this component is about to provide, which
  // does not exist yet.
  const depth = usePopoverDepth();
  const [open, setOpenState] = useState(false);
  /** Raised by `enterPopover` and lowered as the popover closes: the keyboard is being driven inside
   *  this popover. Deliberately not "is focus in the content" — a mouse click on a control in the
   *  popover puts focus there too, and a popover the pointer opened must still close when the pointer
   *  leaves. */
  const keyboardInsideRef = useRef(false);
  const closeReasonRef = useRef<CloseReason>({ entered: false, takeover: false });
  const suppressNextTriggerFocusRef = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingEnterRef = useRef(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dwellState, setDwellState] = useState<"filling" | "locked" | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** The trigger's own DOM node, written by `PopoverTrigger`. What the virtual anchor below falls
   *  back to reading when this open is NOT cursor-anchored — a keyboard open, or before any open
   *  has happened at all — so a keyboard-opened `dwell` popover gets exactly the placement Radix's
   *  own default (self-)anchoring would have given it. */
  const triggerRef = useRef<HTMLElement | null>(null);
  /** The cursor-anchored `virtualRef`'s own live position — a plain ref rather than React state,
   *  since Radix re-reads it every animation frame while `filling` (`updatePositionStrategy`
   *  below) and nothing here needs a re-render when it moves. Frozen at whatever it last was the
   *  instant the pointermove effect below stops running, which is what "stops following" on lock
   *  means: nothing writes to it again until the next open. */
  const dwellAnchorPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Whether THIS open is anchored to the cursor at all — raised only for a pointer-driven open,
   *  left false for a keyboard one (see `setOpen`'s `openedViaKeyboard` branch). A ref mirror of
   *  `cursorAnchored` state below (same pattern as `pinned`/`pinnedRef`): the virtual anchor's
   *  `getBoundingClientRect` closure is created once and must read the CURRENT value on every
   *  call, which a closed-over `cursorAnchored` from the render that created it could never do. */
  const cursorAnchoredRef = useRef(false);
  // Stable identity across renders — Radix compares `virtualRef.current` by reference to decide
  // whether the anchor changed, and this object never needs to: its `getBoundingClientRect`
  // always reads the live refs above rather than closing over a value from the render that
  // created it. That is only safe because this Anchor is mounted AFTER the trigger and so
  // registers last (see the JSX below): Radix's `PopperAnchor` notifies on a reference change and
  // never cleans up, so a registration lost to a later one can never be recovered by an object
  // whose identity does not change. Rendered unconditionally whenever `dwell` is set (see the JSX
  // below) — NEVER conditionally, because toggling whether a custom `Anchor` exists in the tree
  // flips Radix's own `hasCustomAnchor` and changes whether `PopoverTrigger` wraps itself in an
  // extra Popper component, which changes the trigger's position in the Fiber tree and makes React
  // tear down and recreate the actual trigger DOM node — losing whatever the pointer was doing to
  // it mid gesture. Keeping one virtual anchor mounted for the popover's whole life and only ever
  // changing what rect it *reports* avoids that entirely.
  const dwellAnchorVirtualRef = useRef<Measurable>({
    getBoundingClientRect: () =>
      cursorAnchoredRef.current
        ? new DOMRect(dwellAnchorPointRef.current.x, dwellAnchorPointRef.current.y, 0, 0)
        : (triggerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0)),
  });
  const [cursorAnchored, setCursorAnchoredState] = useState(false);
  function setCursorAnchored(next: boolean) {
    cursorAnchoredRef.current = next;
    setCursorAnchoredState(next);
  }
  /** Raised by `openViaFocus` immediately before a `setOpen(true)` it wants opened straight into
   *  `locked` — read and cleared by `setOpen` itself in the same synchronous call, so it can never
   *  leak into a later, unrelated open (a hover-scheduled one included). */
  const keyboardOpenRef = useRef(false);
  const [pinned, setPinnedState] = useState(false);
  // Read by the unmount cleanup below, which cannot depend on `pinned` directly without re-running
  // on every pin (the effect deliberately only depends on `closeSelf` — see its own comment).
  const pinnedRef = useRef(false);
  // Set once, alongside `pinned` itself, by `markPinned`'s own `isDeepest` argument — whether THIS
  // popover was the chain's deepest entry at the instant of pinning. `PopoverContent` gates the
  // pin/unpin control on it (while pinned) so only one level of a pinned chain ever renders the
  // control, matching the live (unpinned) case's own `depthFromTop === 0` gate.
  const [pinnedIsDeepest, setPinnedIsDeepestState] = useState(false);
  // What this popover's own `stackHoverLocalRef` was holding the instant it was pinned — captured so
  // `unmarkPinned` can put it back on unpin (see the docblock's "Unpinning has to restore..."
  // paragraph). Zero whenever this popover is not currently pinned.
  const pinnedHoverRef = useRef(0);
  /** How many of THIS popover's own tracked regions (its trigger, its content) currently hold an
   *  outstanding increment on the module-level `stackHoverCount` — 0 or 1 in ordinary use (trigger
   *  and content are never both under the pointer at once), tracked as a count rather than a flag
   *  only so `markStackEntered`/`markStackLeft` can be called at either site without either needing
   *  to know whether the other already has. What `setPinned` and the unmount cleanup below use to
   *  release this popover's own contribution when it stops being able to balance its own future
   *  enters and leaves. */
  const stackHoverLocalRef = useRef(0);
  function markStackEntered() {
    stackHoverLocalRef.current++;
    noteStackEnter();
  }
  function markStackLeft() {
    if (stackHoverLocalRef.current === 0) return;
    stackHoverLocalRef.current--;
    noteStackLeave();
  }

  function clearDwellTimer() {
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
  }

  // `closeSelf` needs a stable identity for the whole component's
  // lifetime — the exclusivity registry above compares it by reference,
  // and the unmount cleanup below releases the claim by that same
  // reference — while `setOpen` is a fresh function every render.
  // `setOpenRef` bridges the two: reassigned every render, read through
  // the one stable closure the registry holds.
  const setOpenRef = useRef<(next: boolean) => void>(() => {});
  const [closeSelf] = useState<() => void>(() => () => setOpenRef.current(false));

  // Same stable-identity bridge as `closeSelf`/`setOpenRef` above, for the same reason: the registry
  // (`pinStack`/`unpinChain`) holds `markPinned`/`unmarkPinned` by reference across renders, so each
  // has to be created once and read through a ref rather than closing over a fresh setter every
  // render.
  const setPinnedRef = useRef<(next: boolean, isDeepest: boolean) => void>(() => {});
  function setPinned(next: boolean, isDeepest = false) {
    pinnedRef.current = next;
    setPinnedState(next);
    setPinnedIsDeepestState(next && isDeepest);
    // Pinning stops both `PopoverTrigger` and `PopoverContent` from ever calling
    // `markStackEntered`/`markStackLeft` again for this popover (every call site below is gated on
    // `!pinned`) — so any outstanding contribution it made to `stackHoverCount` before this instant
    // would otherwise never be released, permanently inflating the count and blocking the
    // whole-stack leave grace from ever arming again for any FUTURE chain (the count is
    // module-level, shared across the whole app, the same way `openStack` itself is). Captured into
    // `pinnedHoverRef` rather than merely released, so `unmarkPinned` below can put it back — an
    // ordinary close-time reset (`next: false` with nothing to restore) leaves it at 0, which is
    // exactly what a popover with no outstanding hover contact to restore should have.
    if (next) {
      pinnedHoverRef.current = stackHoverLocalRef.current;
      releaseStackHover(stackHoverLocalRef.current);
      stackHoverLocalRef.current = 0;
    } else {
      pinnedHoverRef.current = 0;
    }
  }
  setPinnedRef.current = setPinned;
  const [markPinned] = useState<() => (isDeepest: boolean) => void>(
    () => (isDeepest: boolean) => setPinnedRef.current(true, isDeepest),
  );

  const unmarkPinnedRef = useRef<() => void>(() => {});
  function unmarkPinned() {
    // Read before `setPinned` clears it, so the restore below still has the number it needs.
    const restore = pinnedHoverRef.current;
    setPinnedRef.current(false, false);
    // Puts `stackHoverCount` back exactly where it would be had this popover never been detached:
    // no `pointerenter`/`pointerleave` will ever fire for a pointer that never actually crossed a
    // boundary (it was already resting on this content when the button that un-pinned it was
    // clicked), so nothing else would ever re-increment this popover's own contribution.
    if (restore > 0) {
      stackHoverLocalRef.current += restore;
      for (let i = 0; i < restore; i++) noteStackEnter();
    }
  }
  unmarkPinnedRef.current = unmarkPinned;
  const [markUnpinned] = useState<() => () => void>(() => () => unmarkPinnedRef.current());

  function clearOpenTimer() {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }
  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function setOpen(next: boolean) {
    clearOpenTimer();
    clearCloseTimer();
    if (next) {
      // Read and cleared here, synchronously, so it can only ever apply to THIS open — a plain
      // hover-scheduled open that happens to land right after a keyboard one never inherits it.
      const openedViaKeyboard = keyboardOpenRef.current;
      keyboardOpenRef.current = false;
      claimOpen({ closeSelf, markPinned, unmarkPinned: markUnpinned }, depth);
      // A fresh session records nothing yet, so a content unmount partway through one — a Tracker
      // row dropping out of the list under an open popover — can never replay the previous close's
      // decision and pull focus onto a trigger that is going away too.
      closeReasonRef.current = { entered: false, takeover: false };
      if (dwell) {
        clearDwellTimer();
        if (openedViaKeyboard) {
          // Enter/focus already expressed intent unambiguously — see the docblock's "keyboard
          // opens a dwell popover locked" bullet. Straight to `locked`, no `filling` in between,
          // and no cursor anchor either — `cursorAnchored` stays false, so the virtual anchor's
          // `getBoundingClientRect` reports the trigger's own rect and Radix places the popover
          // exactly where its own default anchor-to-trigger behaviour would have.
          setCursorAnchored(false);
          setDwellState("locked");
        } else {
          // Seeded from the trigger's own last-recorded pointer position (`dwellPointerRef`,
          // written by `PopoverTrigger`) so the anchor starts exactly where the pointer already
          // is, before the pointermove effect below has run even once.
          const seed = dwellPointerRef.current;
          if (seed) dwellAnchorPointRef.current = seed;
          setCursorAnchored(true);
          setDwellState("filling");
          dwellTimerRef.current = setTimeout(() => {
            dwellTimerRef.current = null;
            setDwellState("locked");
          }, DWELL_MS);
        }
      }
    } else {
      releaseOpen(closeSelf);
      if (dwell) {
        clearDwellTimer();
        setDwellState(null);
        setCursorAnchored(false);
        // Pinning is a property of a locked popover, not a state of its own (see the docblock) — a
        // reopen after this one closes starts unpinned, exactly like a fresh popover, rather than
        // silently reopening already detached from the registry.
        setPinned(false);
      }
      // Every close funnels through here (Radix's `onOpenChange` included), so this is the one
      // place both facts are still true: `takeoverInProgress` is only set for the duration of the
      // `claimOpen` call this may be running inside, and the entered flag has to be cleared now so
      // a later reopen never inherits it. `PopoverContent`'s `onCloseAutoFocus`, dispatched after
      // this, reads what was recorded rather than re-deriving it.
      closeReasonRef.current = { entered: keyboardInsideRef.current, takeover: takeoverInProgress };
      keyboardInsideRef.current = false;
    }
    setOpenState(next);
  }
  setOpenRef.current = setOpen;

  // Rows unmount routinely under a live pointer (the Tracker's query is
  // invalidated every economy cycle), and React fires no `pointerleave`
  // for an element that disappears beneath the cursor — so nothing else
  // would ever clear these. A surviving open timer is the damaging one:
  // it fires after this popover is gone, claims the exclusivity registry and
  // closes whichever popover the user is actually reading. `releaseOpen` is
  // reference-guarded, so it is a no-op for a popover that never claimed —
  // it must never blank a claim another popover now holds.
  useEffect(
    () => () => {
      if (openTimerRef.current !== null) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      clearDwellTimer();
      releaseOpen(closeSelf);
      // The dwell stack's return/leave timers are module-level (see their own comments) rather than
      // owned by any one popover, so there is no single instance whose unmount alone should clear
      // them — but clearing them on every popover's unmount was the safe direction to over-apply
      // while at most one chain could ever be live: the worst case was a pending grace not firing,
      // which leaves something open a little longer, never something closing that shouldn't.
      //
      // Pinning breaks that premise — a pinned chain and a fresh unpinned chain can now be live at
      // once — so the over-apply has to stop being unconditional. A popover that was pinned before
      // it unmounts never touches these timers again once pinned (see `PopoverTrigger`'s and
      // `PopoverContent`'s pointer handlers below, every one of which is gated on `pinned`), so it
      // never owns whatever is currently pending on them; clearing anyway would cancel a grace
      // belonging to a different, still-live chain instead of leaving something open a little
      // longer. A popover that was NOT pinned is exactly the pre-pinning case this comment always
      // described, and keeps that same safe-to-over-apply behaviour.
      if (!pinnedRef.current) {
        cancelReturnClose();
        cancelLeaveClose();
      }
      // Same unmount-under-a-live-pointer gap as the timers above, for `stackHoverCount`: no
      // `pointerleave` ever fires for a row that disappears beneath the cursor, so without this an
      // outstanding contribution this popover made would stay counted forever, permanently
      // blocking the whole-stack leave grace from arming again. A no-op if `setPinned` already
      // released it (pinning zeroes `stackHoverLocalRef` on the way in).
      releaseStackHover(stackHoverLocalRef.current);
      stackHoverLocalRef.current = 0;
    },
    [closeSelf],
  );

  // Keeps the virtual anchor's rect tracking the pointer while `filling` — document-level, not the
  // trigger's own `onPointerMove`, because the cursor travels well past the trigger's bounds on its
  // way toward content that (while filling) has `pointer-events: none` and never receives it at
  // all. A plain ref write, not `setState`: nothing here needs to re-render on every pointer move,
  // since `updatePositionStrategy="always"` on `PopoverContent` is what makes Radix re-read this
  // ref every animation frame. Stopping (on `dwellState` leaving `"filling"`, lock included) is the
  // entire "stops following" mechanism — nothing writes to `dwellAnchorPointRef` again until the
  // next open re-seeds it.
  useEffect(() => {
    if (dwellState !== "filling") return;
    const handlePointerMove = (event: PointerEvent) => {
      dwellAnchorPointRef.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener("pointermove", handlePointerMove);
    return () => document.removeEventListener("pointermove", handlePointerMove);
  }, [dwellState]);

  function scheduleOpen() {
    // The hover path, and only the hover path, runs through here — click and keyboard focus open
    // directly rather than on a timer, which is what lets one opt-out suppress the pointer alone.
    if (pointerInert) return;
    if (open) return;
    clearCloseTimer();
    clearOpenTimer();
    // `dwell` ignores the caller's `openDelay` entirely — the mode is tuned as a unit, and a
    // consumer opting into it has no reason to independently tune the grace before it starts.
    openTimerRef.current = setTimeout(() => setOpen(true), dwell ? DWELL_OPEN_DELAY_MS : openDelay);
  }

  function cancelScheduledOpen() {
    clearOpenTimer();
  }

  function openViaFocus() {
    clearOpenTimer();
    // Set unconditionally, whether or not the popover is already open — reaching an already-open,
    // still-`filling` popover this way (Tab back onto a trigger a stray hover left mid-fill) must
    // finish its dwell on the spot too, and `setOpen`'s own `openedViaKeyboard` check below is what
    // does that; there is nothing left for this function itself to special-case. Harmless for the
    // five non-`dwell` consumers, and for a `dwell` popover already `locked`, since `setOpen(true)`
    // is this function's unconditional behaviour on either regardless.
    keyboardOpenRef.current = true;
    setOpen(true);
  }

  /**
   * ArrowDown from the trigger: the deliberate way in. Opens the popover first if it is closed —
   * focus cannot move into content that does not exist yet, so the intent is parked on
   * `pendingEnterRef` and the content picks it up as it mounts.
   */
  function enterPopover() {
    cancelScheduledOpen();
    cancelScheduledClose();
    // Whatever opened this popover, the keyboard is driving it now. This is the flag the pointer-leave
    // grace period stands down for, and the one that earns the focus hand-back on close: without
    // it Escape would drop focus to the document body instead of the trigger the user came from.
    keyboardInsideRef.current = true;
    if (open) {
      focusIntoContent(contentRef.current);
      return;
    }
    pendingEnterRef.current = true;
    setOpen(true);
  }

  function scheduleClose() {
    // The pointer-leave path, and only it, runs through here — so the same opt-out that keeps the
    // pointer from opening this popover keeps it from closing one. Gating the open side alone would
    // leave a consumer that only click and keyboard can open, yet any pointer drift off the trigger
    // dismisses a grace period later.
    if (pointerInert) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      // The pointer wandering off never closes a popover the keyboard was driven into. The user
      // stopped driving with the pointer the moment they entered; closing here would yank the popover
      // out from under them mid-read. Escape is their way out. Checked as the grace period
      // expires, not when it was scheduled, because the enter can happen inside that window.
      //
      // The flag, not "is focus inside the content": a mouse click on a control in the popover puts
      // focus there too, and a popover the pointer opened and clicked into must still close when the
      // pointer leaves — reading focus left it open indefinitely, with no gesture that would shut
      // it short of clicking elsewhere.
      if (keyboardInsideRef.current) return;
      setOpen(false);
    }, CLOSE_GRACE_MS);
  }

  function cancelScheduledClose() {
    clearCloseTimer();
  }

  const context: PopoverContextValue = {
    open,
    side,
    align,
    clickInert,
    depth,
    dwell,
    dwellState,
    dwellPointerRef,
    triggerRef,
    cursorAnchored,
    closeReasonRef,
    suppressNextTriggerFocusRef,
    contentRef,
    pendingEnterRef,
    pinned,
    pinnedIsDeepest,
    pinChain: pinStack,
    unpinChain,
    markStackEntered,
    markStackLeft,
    scheduleOpen,
    cancelScheduledOpen,
    openViaFocus,
    enterPopover,
    scheduleClose,
    cancelScheduledClose,
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverContext.Provider value={context}>
        {children}
        {/* Mounted whenever `dwell` is set — unconditionally, for the whole popover's life, never
            toggled by open/close or by which gesture opened it (see `dwellAnchorVirtualRef`'s own
            comment for why toggling it is unsafe). What changes across opens is only which rect
            `getBoundingClientRect` reports: the cursor point while `cursorAnchoredRef` is raised,
            the trigger's own rect otherwise.

            And it sits AFTER `children`, an order that is load-bearing. Radix's `PopperAnchor`
            notifies the popper context only when the anchor changes BY REFERENCE, and its effect has no
            cleanup. `PopoverTrigger` wraps itself in its own `PopperAnchor` whenever
            `hasCustomAnchor` is false — which it is on the first render, because the flag is only
            raised in this Anchor's own effect. Mounted before the trigger, our effect runs first,
            the trigger's temporary anchor then overwrites the registration with its own (null at
            that moment) ref, and ours never re-registers because its local ref still holds this
            object and so sees no change — leaving Radix positioning against nothing, at the
            viewport origin. Mounted after, our effect runs last and wins. */}
        {dwell && <PopoverPrimitive.Anchor virtualRef={dwellAnchorVirtualRef} />}
      </PopoverContext.Provider>
    </PopoverPrimitive.Root>
  );
}

/**
 * Trigger for a popover, `asChild` like the tooltip trigger — wrap a
 * single interactive element (a row, a button, an icon). Wires pointer
 * hover (with the root's `openDelay`), click, keyboard focus and the
 * ArrowDown that enters the popover, without disturbing whatever handlers the
 * wrapped element already carries.
 */
export const PopoverTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(
  (
    {
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      onPointerDown,
      onPointerUp,
      onFocus,
      onClick,
      onKeyDown,
      ...props
    },
    forwardedRef,
  ) => {
    const popover = usePopoverContext("PopoverTrigger");
    // Local to this trigger: distinguishes a focus event caused by a mouse
    // press (which `onClick`/Radix's own toggle will open) from a genuine
    // keyboard (Tab) focus, which this component must open on its own.
    // Every press ends in a pointer-up or a pointer-leave, so both clear
    // it — a press that never becomes a click (press, drag off, release)
    // must not leave keyboard-open dead for the rest of the row's life.
    const pointerActiveRef = useRef(false);
    // Feeds the cursor-anchor's keyboard-open fallback (`popover.triggerRef`, read by
    // `dwellAnchorVirtualRef`'s `getBoundingClientRect`) — kept in sync with whatever ref the
    // consumer forwarded, the same two-destination-write `PopoverContent`'s `setContentNode` does.
    const setTriggerNode = useCallback(
      (node: HTMLButtonElement | null) => {
        popover.triggerRef.current = node;
        assignForwardedRef(forwardedRef, node);
      },
      [popover.triggerRef, forwardedRef],
    );

    return (
      <PopoverPrimitive.Trigger
        asChild
        ref={setTriggerNode}
        // The gesture is announced rather than left to be discovered: a screen reader reads the
        // shortcut with the trigger's own name, which is the only place a keyboard user would
        // learn that this row has a popover and how to get into it. Before `{...props}`, so a
        // consumer with a different gesture can still say so.
        aria-keyshortcuts="ArrowDown"
        onPointerEnter={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerEnter,
          (event) => {
            // The starting position a `dwell` popover's content places itself at — recorded
            // regardless of mode, since it's cheap and harmless for a hover-mode popover that
            // never reads it.
            popover.dwellPointerRef.current = { x: event.clientX, y: event.clientY };
            popover.cancelScheduledClose();
            popover.scheduleOpen();
            // A `dwell` trigger counts as "resting on the stack" for the leave grace even before
            // its own popover has opened — `dwellState` can't answer that (it is null until open),
            // which is exactly why `dwell` is on the context independently of it. Pinned is the one
            // exception: a pinned popover no longer has a stack entry for a leave grace to defend,
            // and marking it entered here would count towards a DIFFERENT, still-live chain's
            // `stackHoverCount` instead of this (detached) one's own.
            if (popover.dwell && !popover.pinned) popover.markStackEntered();
          },
        )}
        onPointerMove={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerMove,
          (event) => {
            popover.dwellPointerRef.current = { x: event.clientX, y: event.clientY };
          },
        )}
        onPointerLeave={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerLeave,
          () => {
            pointerActiveRef.current = false;
            popover.cancelScheduledOpen();
            // Unconditional on `popover.open`, unlike the plain (non-`dwell`) close below — the
            // enter above marks this trigger entered whether or not its popover has opened yet, so
            // the leave has to balance that same contribution whether or not it opened in between.
            // Skipping this when `!open` (as an earlier version did) leaves a permanent +1 on the
            // shared `stackHoverCount` for every dwell trigger a pointer passes over without
            // lingering long enough to open — exactly the everyday case of scanning a table of
            // underlined terms — and the whole-stack leave grace would stop arming correctly after
            // only a handful of those.
            if (popover.dwell) {
              if (!popover.pinned) popover.markStackLeft();
            } else if (popover.open) {
              // A `dwell` popover never runs the plain `CLOSE_GRACE_MS` pointer-leave close — only
              // the whole-stack leave grace applies to it. Every other (non-`dwell`) consumer keeps
              // exactly its existing `scheduleClose` behaviour, untouched, including this `!open`
              // guard (there is nothing open to close).
              popover.scheduleClose();
            }
          },
        )}
        onPointerDown={composeHandlers<React.PointerEvent<HTMLButtonElement>>(onPointerDown, () => {
          pointerActiveRef.current = true;
        })}
        onPointerUp={composeHandlers<React.PointerEvent<HTMLButtonElement>>(onPointerUp, () => {
          // Fires after the focus a mouse press causes, so clearing here
          // still lets that focus be recognised as pointer-driven.
          pointerActiveRef.current = false;
        })}
        onFocus={composeHandlers<React.FocusEvent<HTMLButtonElement>>(onFocus, () => {
          if (popover.suppressNextTriggerFocusRef.current) {
            // Radix returning focus here after a close, not a real Tab press.
            popover.suppressNextTriggerFocusRef.current = false;
            return;
          }
          if (pointerActiveRef.current) return;
          popover.cancelScheduledOpen();
          popover.openViaFocus();
        })}
        onKeyDown={composeHandlers<React.KeyboardEvent<HTMLButtonElement>>(onKeyDown, (event) => {
          const bare = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
          // Enter, `dwell` popovers only — see the docblock's "keyboard opens a dwell popover
          // locked" bullet. The five existing (non-`dwell`) consumers keep the browser's own
          // Enter-activates-a-button default entirely: no handling here, so the resulting click
          // still reaches Radix's ordinary open/close toggle exactly as it does today.
          if (popover.dwell && event.key === "Enter" && !event.defaultPrevented && bare) {
            // Consumed, so a term's Enter never falls through to the native click — that click
            // would run Radix's own toggle and open into ordinary `filling` (or, worse, close an
            // already-open popover), neither of which is the locked-immediately behaviour this
            // key is for.
            event.preventDefault();
            popover.openViaFocus();
            return;
          }
          // ArrowDown is the way in — see the convention in Popover's docblock. Bare only: a
          // modified ArrowDown belongs to the browser (and Alt+Down is a native combobox gesture
          // on some platforms). A wrapped element that already handled the key keeps it.
          if (event.key !== "ArrowDown" || event.defaultPrevented) return;
          if (!bare) return;
          // Consumed, so the page behind the popover does not scroll on the same press.
          event.preventDefault();
          popover.enterPopover();
        })}
        onClick={composeHandlers<React.MouseEvent<HTMLButtonElement>>(onClick, (event) => {
          pointerActiveRef.current = false;
          popover.cancelScheduledOpen();
          // Radix's own Trigger composes ITS click-toggle after this handler and skips it once
          // the event is marked defaultPrevented (see Popover's docblock) — this is the only line
          // `clickInert` adds.
          if (popover.clickInert) event.preventDefault();
        })}
        {...props}
      />
    );
  },
);
PopoverTrigger.displayName = "PopoverTrigger";

/**
 * The hairline fill bar `PopoverContent` renders across its top while a `dwell` popover is
 * `filling` — an element of the popover rather than a free-standing component (`ProgressBar`
 * doesn't fit: it's a labelled data readout with a `progressbar` role and an `aria-valuenow`,
 * and this bar has no value, no label and nothing worth announcing — see the build plan's Reuse
 * note). Renders at 0% width and flips to 100% a commit after mount so the transition actually
 * plays, over `durationMs` — always `DWELL_MS`, the same constant that drives the lock timer in
 * `Popover`, so the bar can never promise a lock at a different moment than the one that arrives.
 * The duration lives only in the inline `transitionDuration` style below, which is real DOM state
 * this component itself sets (readable via `el.style.transitionDuration`, with no stylesheet
 * involved) rather than a bespoke test-only attribute.
 */
function DwellBar({ durationMs }: { durationMs: number }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    setFilled(true);
  }, []);
  return (
    <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px overflow-hidden bg-border">
      <div
        className={twMerge(
          "h-full bg-accent transition-[width] ease-linear",
          filled ? "w-full" : "w-0",
        )}
        style={{ transitionDuration: `${durationMs}ms` }}
      />
    </div>
  );
}

interface PopoverContentProps
  extends Omit<PopoverPrimitive.PopoverContentProps, "side" | "align"> {}

/** Writes a node to a forwarded ref of either shape, so an element can be handed to a consumer's
 *  ref AND kept on one of the popover's own internal refs (`contentRef`, `triggerRef`) at the same
 *  time. Generic over the element type — `PopoverTrigger` uses it for a button, `PopoverContent`
 *  for a div. */
function assignForwardedRef<T>(ref: ForwardedRef<T>, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className = "",
      sideOffset = 8,
      style,
      onPointerEnter,
      onPointerLeave,
      onOpenAutoFocus,
      onCloseAutoFocus,
      children,
      ...props
    },
    ref,
  ) => {
    const popover = usePopoverContext("PopoverContent");
    const { contentRef, pendingEnterRef, dwellState } = popover;

    // The depth cue: how far this popover sits from the top of the CURRENT stack, recomputed
    // whenever the stack's length changes (`subscribeStackLength`) rather than only on this
    // popover's own open/close. For a single-level stack (every existing non-`dwell` consumer)
    // `stackLength` is always 1 when open, so `depthFromTop` is always 0 — full opacity, no change.
    // A pinned popover is no longer IN that stack at all — `stackLength` and its own stale `depth`
    // together would compute a meaningless number for it — so it short-circuits to full opacity
    // instead of being run through the maths a live entry uses.
    const stackLength = useSyncExternalStore(subscribeStackLength, getStackLength, getStackLength);
    const depthFromTop = Math.max(0, stackLength - 1 - popover.depth);
    const opacity = popover.pinned ? 1 : opacityForDepth(depthFromTop);

    // The pin/unpin control renders at exactly one level of a chain, never one per open level: the
    // live top of `openStack` while unpinned (`depthFromTop === 0`), or whichever entry was deepest
    // at the instant of pinning while pinned (`pinnedIsDeepest`, frozen by `pinStack` and never
    // recomputed). The control follows the pointer down as the chain grows, so there is never a
    // question of which level a click pins or unpins from.
    const showPinControl =
      popover.dwell &&
      dwellState === "locked" &&
      (popover.pinned ? popover.pinnedIsDeepest : depthFromTop === 0);

    // Placement itself is entirely Radix's now — the virtual cursor `Anchor` `Popover` mounts and
    // tracks (see its own docblock and comments). Nothing left here sets `position`/`top`/`left`;
    // the only per-dwell-state style this component still owns is turning the pointer off while
    // `filling`, so a passing hover on the way to the lock can't be clicked through.
    //
    // `updatePositionStrategy="always"` while `filling` is what makes Radix re-read the virtual
    // anchor's `getBoundingClientRect` every animation frame, so the popper keeps up with the
    // pointer live; back to the default `"optimized"` once `locked`, since nothing is moving the
    // anchor any more and continuous polling would just be wasted work.
    const updatePositionStrategy = dwellState === "filling" ? "always" : "optimized";

    const dwellStyle: CSSProperties | undefined =
      dwellState === null ? undefined : { pointerEvents: dwellState === "filling" ? "none" : undefined };

    // Clears the cursor vertically rather than opening under it — see `DWELL_CURSOR_CLEARANCE_PX`'s
    // own comment. Only the `sideOffset` changes; `align` is left at `popover.align` (never
    // overridden to `"start"`) so the popover stays horizontally centred on the cursor, the same as
    // every other popover is centred on its anchor. Only while cursor-anchored; a keyboard-opened
    // `dwell` popover and every non-dwell consumer keep the ordinary `sideOffset` a trigger-anchored
    // popover already used.
    const effectiveSideOffset = popover.cursorAnchored ? DWELL_CURSOR_CLEARANCE_PX : sideOffset;

    // Attaching the content element is also where an enter that had to open the popover first gets
    // paid off — this is the first instant the content exists. Deliberately not an effect keyed
    // on `open`: this component stays mounted for the consumer's whole lifetime, and Radix's
    // `Presence`, one level further in, mounts the content element a commit LATER than the open
    // state flips, so such an effect would run with nothing yet to focus and never run again.
    const setContentNode = useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node;
        assignForwardedRef(ref, node);
        if (!node || !pendingEnterRef.current) return;
        pendingEnterRef.current = false;
        focusIntoContent(node);
      },
      [ref, contentRef, pendingEnterRef],
    );

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={setContentNode}
          side={popover.side}
          align={popover.align}
          sideOffset={effectiveSideOffset}
          updatePositionStrategy={updatePositionStrategy}
          // Real state this component decided at open time (`Popover`'s `cursorAnchored`), not a
          // bespoke test hook — which anchor mode is live is exactly what a devtools inspection
          // needs to explain where the popper's own transform is coming from. `undefined` outside
          // `dwell` mode, so the five existing hover-mode consumers carry no such attribute at all.
          data-dwell-anchor={
            dwellState === null ? undefined : popover.cursorAnchored ? "cursor" : "trigger"
          }
          style={{ ...style, ...dwellStyle, opacity }}
          onPointerEnter={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerEnter, () => {
            popover.cancelScheduledClose();
            // A pinned popover has no registry entry left to defend, so the return grace below and
            // the shared hover count above must both stay untouched — marking it entered here would
            // count towards whatever a DIFFERENT, still-live chain currently has pending on them.
            if (!popover.dwell || popover.pinned) return;
            // Only a `locked` popover's content ever genuinely receives this — a `filling` one has
            // `pointer-events: none` in a real browser and would never dispatch it in the first
            // place. Gated the same way on both enter and leave (the leave handler below always
            // was, defensively) so the two stay a matched pair: an entered content this component
            // never counted as entered would have nothing for the leave to balance either.
            if (dwellState !== "locked") return;
            // Resting on any `dwell` popover in the stack means the pointer is not off it, whatever
            // depth it is at — `markStackEntered` cancels the whole-stack leave grace as part of
            // recording that.
            popover.markStackEntered();
            scheduleReturnClose(popover.depth);
          })}
          onPointerLeave={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerLeave, () => {
            // A `dwell` popover never runs the plain `CLOSE_GRACE_MS` pointer-leave close — only the
            // whole-stack leave grace applies to it. Every other (non-`dwell`) consumer keeps
            // exactly its existing `scheduleClose` behaviour, untouched. A pinned popover runs
            // neither: it survives until dismissed.
            if (popover.dwell) {
              if (!popover.pinned && dwellState === "locked") {
                popover.markStackLeft();
                // Schedules THIS popover's own close, and it is the pointer leaving — not some
                // ancestor being entered — that has to drive it, because the enter can never
                // arrive. A nested popover's content renders inside its parent's content, so
                // moving from a child back onto its parent never leaves the parent's subtree and
                // fires no `pointerenter` on it; only the child's own `pointerleave` is dispatched.
                // Hanging the return close off the ancestor's enter left a chain that could only
                // be walked forwards. Re-entering this content before the grace elapses reschedules
                // from the enter handler above, and leaving the stack entirely is still the leave
                // grace's job, which closes every depth rather than one.
                // Depth 0 is excluded deliberately: `closeFromDepth(-1)` is the close-everything
                // sentinel, so scheduling it here would turn "left the outermost popover" into
                // "close the whole stack" via the return grace. Leaving the outermost popover is
                // the LEAVE grace's job — it is the one that knows whether the pointer reached
                // anything else in the stack or genuinely left it.
                if (popover.depth > 0) scheduleReturnClose(popover.depth - 1);
              }
            } else {
              popover.scheduleClose();
            }
          })}
          onOpenAutoFocus={composeHandlers<Event>(onOpenAutoFocus, (event) => {
            // The popover NEVER takes focus, however it was opened. A popover describes the thing
            // its trigger already is, so focus belongs on the trigger: these triggers are rows in
            // a list, and the content is portalled to the end of the document, so a popover that
            // takes focus puts every remaining row behind it in tab order — the next Tab has
            // nowhere to go and focus sticks on whatever the popover contains.
            //
            // Controls inside a popover are not lost to the keyboard by this: they are reached by a
            // deliberate way IN — ArrowDown on the trigger — rather than by a focus grab that
            // breaks walking the list. That enter is `focusIntoContent`, called from the trigger
            // or from `setContentNode` above, so opening and entering stay two separate steps
            // even when one ArrowDown does both.
            event.preventDefault();
          })}
          onCloseAutoFocus={composeHandlers<Event>(onCloseAutoFocus, (event) => {
            const { entered, takeover } = popover.closeReasonRef.current;
            if (!entered || takeover) {
              // Two closes with nothing to hand back, for two different reasons.
              //
              // Not entered: the popover never took focus — `onOpenAutoFocus` above suppresses that —
              // so a focus return here would MOVE the user rather than restore them, onto the
              // trigger of a row the pointer is in the middle of leaving.
              //
              // A takeover: another popover has just opened and holds the registry. Focus landing on
              // this trigger is outside that popover, and a `focusin` outside a Radix layer is enough
              // to dismiss it — the incoming popover would flash and vanish in the same frame,
              // whether this one was entered or not. The cost is real and stated in the docblock:
              // a popover the keyboard was inside, evicted by a pointer opening the next row, leaves
              // focus on the document body.
              event.preventDefault();
              return;
            }
            // The only moment Radix may hand focus back to the trigger. Its
            // non-modal Content calls this handler first, then focuses the
            // trigger synchronously — but only when the close did NOT come
            // from an interaction outside the popover. That programmatic focus
            // is indistinguishable, at the trigger's `onFocus`, from a real
            // Tab press, and would reopen the popover that just closed.
            //
            // So the flag is raised here and lowered again on the microtask
            // that follows this dispatch: any focus Radix returns lands
            // inside it, and any later, genuine Tab does not. Setting it at
            // close time instead left it raised forever whenever Radix chose
            // not to return focus — swallowing one real Tab-to-open, which
            // reads as flakiness rather than as a bug.
            popover.suppressNextTriggerFocusRef.current = true;
            queueMicrotask(() => {
              popover.suppressNextTriggerFocusRef.current = false;
            });
          })}
          className={twMerge(
            // `w-max` + a `max-w` ceiling (clamped to the viewport) rather than a fixed width: the
            // browser measures each popover's own widest row instead of every call site picking one
            // of a handful of hand-tuned widths (`w-56`/`w-64`/`w-80`) that drift out of sync with
            // whatever content actually landed there. The ceiling does double duty — it is also what
            // makes a prose body (a glossary `TermBody` definition) wrap into a readable paragraph
            // instead of stretching to its own single-line max-content width. `text-xs` is the one
            // body size this whole surface uses; a game this dense in small text has no reason for a
            // popover body to default to anything else, and every finer distinction a body still
            // wants (a `text-[10px]` caption, a `text-[9px]` micro-label) stays a deliberate,
            // explicit override on top of this rather than the default itself varying by call site.
            "z-50 w-max max-w-[min(24rem,calc(100vw-2rem))] border border-border-strong border-l-2 border-l-accent bg-surface p-3 text-left text-xs shadow-lg animate-in fade-in-0 zoom-in-95",
            className,
          )}
          {...props}
        >
          {dwellState === "filling" && <DwellBar durationMs={DWELL_MS} />}
          {children}
          {/* After `children`, not before: `focusIntoContent`/ArrowDown focuses the FIRST
             focusable element in the content, and that has to stay whatever the popover's own
             body puts first (a nested term trigger included) — not this control, and not a
             `PopoverHeader` title either, since a header renders as ordinary `children` content
             ahead of whatever the body nests inside it. */}
          {showPinControl && (
            <Button
              type="button"
              variant="ghost"
              size="iconXs"
              aria-label={popover.pinned ? "Unpin" : "Pin"}
              aria-pressed={popover.pinned}
              className="absolute right-1 top-1"
              onClick={() => (popover.pinned ? popover.unpinChain() : popover.pinChain())}
            >
              <PinIcon className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

export interface PopoverHeaderProps {
  /** The header's own heading — what several popover bodies used to render as their own first
   *  `<p className="font-display ...">` line (`PotentialYieldPopoverBody`, `DepositPopoverBody`,
   *  `BuildingPopoverBody`, `NeedPopoverBody`, `TermLabel`'s own body), each a slightly different
   *  hand-rolled heading competing with this one. */
  title: ReactNode;
  /** Extra content on the header's own row, right of the title — a status figure, a badge — laid out
   *  to the LEFT of the space this header reserves for the pin control, never underneath it. */
  meta?: ReactNode;
  className?: string;
}

/**
 * A popover body's optional heading row: a title, room for one more figure beside it, and a gutter
 * on the right sized to the pin/unpin control `PopoverContent` may render over this same top-right
 * corner — reserved unconditionally (whether or not THIS particular popover currently shows the
 * control) so the header's own layout never shifts depending on chain depth. `pr-6` is
 * `right-1` (0.25rem) plus the button's own `iconXs` width (`h-5 w-5`, 1.25rem) — the exact footprint
 * `PopoverContent`'s `absolute right-1 top-1` button occupies.
 *
 * Purely presentational — this file has no opinion on whether a body uses it, and a body with
 * nothing worth naming (`YieldPopoverBody`, whose first line is already a labelled figure, or
 * `HabitabilityPopoverBody`, whose own headline states its own percentage) is free to render nothing
 * here at all.
 */
export function PopoverHeader({ title, meta, className }: PopoverHeaderProps) {
  return (
    <div
      className={twMerge(
        "mb-1.5 flex items-baseline justify-between gap-3 border-b border-border/60 pb-1 pr-6",
        className,
      )}
    >
      <span className="whitespace-nowrap font-display font-semibold text-text-primary">{title}</span>
      {meta}
    </div>
  );
}
