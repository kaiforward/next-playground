"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
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
 *   of its distance from the top of the stack, recomputed whenever the registry changes via
 *   a small module-level subscription (`subscribeRegistryChange`) — `openStack` itself is
 *   deliberately not React state, so this is the one place a change to it is broadcast to whatever
 *   renders off it. Harmless for a single-level stack: depth-from-top is always 0 there, which is
 *   full opacity.
 * - Hover accounting by REGION, not by pointer event: each popover owns two tracked regions (its
 *   trigger and its own locked content), and its share of the module-level `stackHoverCount` is
 *   DERIVED from which of them the pointer is currently inside rather than accumulated from
 *   whichever enter/leave pairs happened to fire (`syncStackHover`). An element can vanish under
 *   the cursor without ever dispatching `pointerleave` — Radix's `Presence` removing the content on
 *   Escape or on a takeover, a Tracker row dropping out of its list mid-hover — so a region
 *   releases its own contribution as it unmounts (`PopoverBody`'s cleanup for the content,
 *   `Popover`'s own for the whole popover) instead of waiting for an event that will never arrive.
 *   Deriving also makes pinning symmetric: pinning drops this popover's share to zero and
 *   unpinning recomputes it from where the pointer actually is at that moment, so unpinning by
 *   keyboard with the pointer somewhere else entirely restores nothing rather than restoring a
 *   value captured when it was pinned.
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
 *   for a pinned chain it is the deepest entry its chain STILL HOLDS (`isDeepestPinnedEntry`, read
 *   live through the same registry subscription the depth cue uses). Live, not frozen at the instant
 *   of pinning: a click inside an ancestor's layer but outside the deepest one dismisses that one
 *   alone, and the level below it has to inherit the control rather than the whole chain being left
 *   floating with no unpin affordance. The control follows the pointer down as the chain grows, so
 *   there is never a question of which level a click pins or unpins from.
 *
 *   `pinChain()` (on context, wired to the button's `onClick` while unpinned) detaches every entry
 *   currently in `openStack` — this popover's whole chain, ancestors and already-open descendants
 *   alike, not only the one the button was clicked on — from the registry in one go (`pinStack`): the
 *   array is emptied, notifying `subscribeRegistryChange`, pushed onto the module-level
 *   `pinnedChains` (so `unpinChain` below has something to reverse), and each detached entry's own
 *   `pinned` React state flips true. A `pinned` popover stops responding to the return and leave
 *   graces (every pointer handler above that touches `scheduleReturnClose` is gated on it, and its
 *   own share of `stackHoverCount` derives to zero for as long as it is pinned — see the hover
 *   accounting bullet above), holds full opacity
 *   regardless of the live stack's length (`PopoverContent`'s own opacity calc short-circuits on it,
 *   since a detached popover's stale `depth` against the CURRENT stack's length would compute a
 *   meaningless number), and survives until dismissed — Escape and an outside click still reach it,
 *   since neither routes through this file's own machinery at all (Radix's own
 *   `DismissableLayer`/`FocusScope` per `Popover.Root`). A term inside a pinned popover reads depth 0
 *   from `usePopoverDepth` rather than one more than its pinned ancestor's, so it starts a fresh chain
 *   instead of extending the pinned one.
 *
 *   **More than one chain can be pinned at a time, and each keeps its own way out.** `pinnedChains`
 *   is a list of detached chains rather than a single slot: pinning exists so two things can be
 *   compared side by side, and a second pin must not strand the first behind an Unpin button that
 *   would reattach somebody else's chain. Each pinned popover's `unpinChain()` acts on the chain
 *   that actually holds its own entry (`unpinChainOf`, matched by `closeSelf` identity), and an
 *   entry whose popover closes or unmounts drops out of its chain (`releasePinnedEntry`) so a later
 *   unpin never reattaches something that is no longer on screen.
 *
 *   **Unpinning is not a request to close.** `unpinChain()` (wired to the same button once pinned) is
 *   `pinStack`'s exact inverse: it pushes every entry in that chain back into `openStack`, in their
 *   original order, and flips each back to unpinned. Escape remains a way to close the chain, but it
 *   is no longer the ONLY way out of a pinned one — the button that pinned it un-pins it too, from the
 *   same place. If a fresh, unrelated chain has since claimed depth 0 (a pinned chain and a live one
 *   can coexist — see below), that rival is closed first, via the exact same "claim beats incumbent"
 *   path `claimOpen` already runs for any depth-0 contest (`closeRivalAt`, factored out of `claimOpen`
 *   so both callers share it rather than each reimplementing "close whatever is there first").
 *
 *   Unpinning restores each entry's `stackHoverCount` contribution as a consequence of how that
 *   count is kept rather than as a step of its own: the share is derived from which of the popover's
 *   own regions the pointer is inside (see the hover accounting bullet above), so flipping `pinned`
 *   back off simply recomputes it. Unpinning by mouse — the pointer resting on the very content the
 *   Unpin button lives in, having never crossed a boundary and so never about to fire a
 *   `pointerenter` — puts the contribution back; unpinning by keyboard with the pointer long since
 *   moved elsewhere restores nothing, because there is nothing there to restore.
 *
 *   Detaching mid-grace matters: `scheduleReturnClose`/`scheduleLeaveClose` read `openStack` LIVE
 *   when they fire, so `pinStack` cancels both before emptying the array — otherwise a grace already
 *   pending for the chain being pinned would fire after the array is emptied (or reused by a fresh
 *   chain) and act on whatever now occupies those depths instead of the popovers it was scheduled
 *   for.
 *
 *   The reverse direction needed its own fix: every popover's unmount used to clear both timers
 *   unconditionally, which was safe only because at most one chain could ever be live — clearing on
 *   any unmount was always safe-to-over-apply when there was nothing else pending to lose. Two
 *   things break that premise, and the unmount cleanup below is gated against both. A pinned chain
 *   and a fresh unpinned chain can be live at once, and the pinned one's eventual dismissal — its
 *   own root closing, tearing down every popover nested in its content — unmounts every popover in
 *   it at once, each running that same cleanup; a pinned popover never owns what is pending on
 *   these timers, since it stopped scheduling either the moment it was pinned. And a NON-`dwell`
 *   popover never owns them at all, in any state — it schedules neither grace at any point in its
 *   life, so its unmount (an alert chip's whose count dropped to zero this tick, a Tracker row's
 *   dropping out of the list) cancelling them would cancel a live dwell chain's pending close and
 *   leave that chain hanging open indefinitely. So the clear runs only for an unpinned `dwell`
 *   popover: the one kind that can actually have scheduled what it is about to cancel.
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

/** One popover's registry entry: `closeSelf` is what exclusivity has always compared and called, and
 *  doubles as the entry's identity everywhere else in this registry (a pinned entry finding its own
 *  chain, an entry dropping out of one). `markPinned`/`unmarkPinned` are the same kind of
 *  stable-identity closures, added for pinning — the one way the registry can tell a popover to
 *  detach itself (or reattach) without the registry needing to know anything about React state
 *  itself. */
interface StackEntry {
  closeSelf: () => void;
  markPinned: () => void;
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
  notifyRegistryChange();
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
  notifyRegistryChange();
  // Deepest first: each closes itself, and the `releaseOpen` re-entry that
  // triggers is now a no-op — the truncation above already dropped it — so
  // this single pass closes every depth above `index` in one go, however
  // many levels deep, rather than stranding a descendant when its ancestor
  // closes. Each of those re-entrant calls finds `index === -1` and returns
  // before it would call `notifyRegistryChange()` again, so a multi-level
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
  if (entries.length === 0) return;
  openStack = [];
  pinnedChains.push(entries);
  cancelReturnClose();
  cancelLeaveClose();
  notifyRegistryChange();
  for (const entry of entries) entry.markPinned();
}

// Every currently pinned chain, each in its own original depth order — empty whenever nothing is
// pinned. A LIST, not a single slot: pinning exists so two things can be compared side by side, so
// pinning a second chain while a first is still pinned is an ordinary flow rather than an
// unreachable one, and each chain has to keep its own identity or the surviving Unpin button would
// reattach somebody else's chain.
let pinnedChains: Array<Array<StackEntry>> = [];

/** The pinned chain holding `closeSelf`, or undefined if that popover is not pinned. */
function pinnedChainOf(closeSelf: () => void): Array<StackEntry> | undefined {
  return pinnedChains.find((chain) => chain.some((entry) => entry.closeSelf === closeSelf));
}

/**
 * Whether `closeSelf` is the deepest entry its own pinned chain still holds — what decides which
 * level of a pinned chain renders the unpin control. Read live (through `subscribeRegistryChange`)
 * rather than frozen at pin time, so dismissing just the deepest level of a pinned chain hands the
 * control down to the level below it instead of leaving the rest with no way out but Escape.
 */
function isDeepestPinnedEntry(closeSelf: () => void): boolean {
  const chain = pinnedChainOf(closeSelf);
  if (!chain || chain.length === 0) return false;
  return chain[chain.length - 1].closeSelf === closeSelf;
}

/**
 * Drops one entry out of whatever pinned chain holds it — a pinned popover closing (Escape, a click
 * outside its own layer) or unmounting. Without this a chain would keep entries that are no longer
 * on screen: a later unpin would push them back into `openStack`, inflating the depth cue and
 * leaving the registry answering for popovers that closed long ago.
 */
function releasePinnedEntry(closeSelf: () => void) {
  const chain = pinnedChainOf(closeSelf);
  if (!chain) return;
  const index = chain.findIndex((entry) => entry.closeSelf === closeSelf);
  chain.splice(index, 1);
  if (chain.length === 0) pinnedChains = pinnedChains.filter((candidate) => candidate !== chain);
  notifyRegistryChange();
}

/**
 * `pinStack`'s exact inverse for ONE chain — the one holding `closeSelf`, so a popover's own Unpin
 * button can only ever reattach its own chain: every entry goes back into `openStack`, in their
 * original order, and each flips back to unpinned. A no-op if that popover is not pinned (the button
 * that calls this only exists while it is).
 *
 * A fresh, unpinned chain may have claimed depth 0 in the meantime — pinning and unpinning are both
 * player-paced, and nothing stops a new hover starting a chain of its own while this one sat detached
 * — so whatever now holds depth 0 is closed first via `closeRivalAt`, the exact same "claim beats
 * incumbent" rule `claimOpen` already applies to any depth-0 contest.
 */
function unpinChainOf(closeSelf: () => void) {
  const entries = pinnedChainOf(closeSelf);
  if (!entries || entries.length === 0) return;
  pinnedChains = pinnedChains.filter((chain) => chain !== entries);
  closeRivalAt(0, entries[0]);
  openStack = entries.slice();
  notifyRegistryChange();
  for (const entry of entries) entry.unmarkPinned();
}

// Reactive mirror of the registry — `openStack`'s length, and which entries the pinned chains still
// hold. Neither is React state (see `openStack`'s own comment above), so this is the one place a
// change to either is broadcast to whatever is rendering off it (the depth-cue opacity below, and
// which level of a pinned chain shows the unpin control).
const registryListeners = new Set<() => void>();

function notifyRegistryChange() {
  for (const listener of registryListeners) listener();
}

function subscribeRegistryChange(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
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

/** Gives one unit of `stackHoverCount` back without arming the leave grace even if that brings the
 *  count to zero — used wherever a region stops holding the pointer for a reason that is not the
 *  pointer having gone somewhere else (a region unmounting under the cursor, a popover being
 *  pinned): "quietly correct the accounting" is the safe direction here, the same one the timer
 *  clearing elsewhere in this file already uses — leaving something open a little longer is fine,
 *  closing something that shouldn't is not. */
function releaseStackHover() {
  stackHoverCount = Math.max(0, stackHoverCount - 1);
}

/** The two tracked regions one popover owns: the trigger, which is live for the popover's whole
 *  lifetime, and its own content, which only exists while the popover is open and LOCKED — and which
 *  Radix's `Presence` can remove from under the cursor without any `pointerleave` ever firing, which
 *  is why each region releases its own share as it goes rather than relying on a matching event. */
type HoverRegion = "trigger" | "content";

// Focusable-in-a-popover-BODY selector. Deliberately attribute-based (`:not([disabled])` rather
// than `:not(:disabled)`) so it reads the same in every DOM implementation the tests run in.
// Every clause is scoped to descend from `[data-popover-body]` — the wrapper `PopoverContent`
// renders around `{children}` only, never around its own header region — so this can never match
// the pin control or a header title, however either is arranged in the DOM. That is what lets the
// header render BEFORE `{children}` (ordinary document order, no `absolute`/`order` positioning
// trick needed to put the pin where it visually belongs): the guarantee that ArrowDown reaches the
// body's own first focusable element is now enforced by the query's scope, not by DOM order.
const FOCUSABLE_IN_POPOVER_BODY = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
]
  .map((selector) => `[data-popover-body] ${selector}`)
  .join(", ");

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
  const first = content?.querySelector<HTMLElement>(FOCUSABLE_IN_POPOVER_BODY);
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
  /** Whether THIS popover is the deepest entry its own pinned chain still holds — read live off the
   *  registry, not frozen at pin time, so a chain whose deepest level is dismissed on its own hands
   *  the unpin control down rather than losing it. Meaningless while `pinned` is false;
   *  `PopoverContent` only reads it gated on `pinned` being true, alongside `depthFromTop === 0` for
   *  the live (unpinned) case. Together they are what limits the pin/unpin control to a single level
   *  of the chain — the one the pointer most recently reached — rather than rendering one per open
   *  level. A getter rather than a value, since `PopoverContent` subscribes to it through
   *  `subscribeRegistryChange`. */
  isDeepestPinned: () => boolean;
  /** Detaches every entry currently in the open stack (this popover's whole chain, ancestors and
   *  already-open descendants alike) from the registry in one go. Exposed so `PopoverContent` can
   *  wire it to the pin control it renders in `dwell` mode. */
  pinChain: () => void;
  /** `pinChain`'s exact inverse for THIS popover's own chain — re-attaches it and flips every entry
   *  back to unpinned, leaving any other pinned chain alone. What the SAME control calls once
   *  `pinned` is true, so unpinning never requires Escape. */
  unpinChain: () => void;
  /** A tracked region of THIS popover (its trigger or its own locked content) entered/left by the
   *  pointer — what `PopoverTrigger` and `PopoverContent` call instead of the module-level
   *  `cancelLeaveClose`/`scheduleLeaveClose` directly, so the whole-stack leave grace arms only
   *  once NOTHING in the stack is entered, not on whichever of two racing leave/enter events last
   *  happened to fire (see `noteStackEnter`/`noteStackLeave`'s own comments). `releaseContentRegion`
   *  is the same as `markRegionLeft("content")` except that it never arms the leave grace: it is
   *  what the content calls as it UNMOUNTS, where nothing can be inferred about where the pointer
   *  went. */
  markRegionEntered: (region: HoverRegion) => void;
  markRegionLeft: (region: HoverRegion) => void;
  releaseContentRegion: () => void;
  /** The id of the trigger element, so `PopoverContent` can name its dialog after the control that
   *  opened it whenever it has no title and no name of its own (see the header block below). */
  triggerId: string;
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
  // Put on the trigger element, and referenced by the content's `aria-labelledby` whenever nothing
  // better names it — a dialog whose name is the control that opened it beats an unnamed one, and
  // `role="dialog"` gets no automatic name from anywhere.
  const triggerId = useId();
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
  // on every pin (the effect deliberately only depends on `closeSelf` — see its own comment), and by
  // `syncStackHover` below, which has to answer for the CURRENT pin state rather than the one the
  // render that created a pointer handler closed over.
  const pinnedRef = useRef(false);
  // Read by the same unmount cleanup, for the same reason `pinnedRef` is: it must run on unmount
  // alone, so it depends on `closeSelf` and reads everything else through a ref.
  const dwellRef = useRef(dwell);
  dwellRef.current = dwell;
  /** Which of THIS popover's two tracked regions the pointer is currently inside — plain DOM truth,
   *  written by every enter/leave regardless of whether the popover is pinned, and cleared by a
   *  region unmounting. Deliberately NOT "how many units of `stackHoverCount` this popover holds":
   *  the share is derived from this (`syncStackHover`), so a state change that alters the share
   *  without any pointer event — pinning, unpinning, the content vanishing under the cursor — is a
   *  recompute rather than a bookkeeping entry that has to be remembered and replayed later. */
  const enteredRegionsRef = useRef<Record<HoverRegion, boolean>>({ trigger: false, content: false });
  /** How many units of the module-level `stackHoverCount` this popover is currently holding — 0, 1
   *  or (only for the instant of a genuine transit between its trigger and its content) 2. Kept in
   *  step with `enteredRegionsRef` by `syncStackHover` alone; nothing else writes it. */
  const heldHoverRef = useRef(0);
  /**
   * Reconciles this popover's share of `stackHoverCount` with what its regions actually hold right
   * now. `arm` is what the difference between a leave and a release comes down to: a region the
   * pointer genuinely left may arm the whole-stack leave grace (via `noteStackLeave`, which arms
   * only if the count reaches zero), while a region that stopped counting for any other reason — it
   * unmounted, or the popover was pinned — gives its unit back quietly, since nothing about where
   * the pointer went can be inferred from either.
   */
  function syncStackHover(arm: boolean) {
    const entered = enteredRegionsRef.current;
    // A pinned popover has no registry entry left for a grace to defend, so it must contribute
    // nothing: were it still counted, the pointer resting on it would hold off the leave grace of a
    // DIFFERENT, still-live chain.
    const share = pinnedRef.current ? 0 : Number(entered.trigger) + Number(entered.content);
    while (heldHoverRef.current < share) {
      heldHoverRef.current++;
      noteStackEnter();
    }
    while (heldHoverRef.current > share) {
      heldHoverRef.current--;
      if (arm) noteStackLeave();
      else releaseStackHover();
    }
  }
  function markRegionEntered(region: HoverRegion) {
    enteredRegionsRef.current[region] = true;
    syncStackHover(true);
  }
  function markRegionLeft(region: HoverRegion) {
    enteredRegionsRef.current[region] = false;
    syncStackHover(true);
  }
  // Bridged through a ref for the same stable-identity reason as `closeSelf` below: `PopoverBody`
  // holds this across its whole mounted life so it can run exactly once, as it unmounts.
  const releaseContentRegionRef = useRef<() => void>(() => {});
  releaseContentRegionRef.current = () => {
    enteredRegionsRef.current.content = false;
    syncStackHover(false);
  };
  const [releaseContentRegion] = useState<() => void>(
    () => () => releaseContentRegionRef.current(),
  );

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
  // (`pinStack`/`unpinChainOf`) holds `markPinned`/`unmarkPinned` by reference across renders, so
  // each has to be created once and read through a ref rather than closing over a fresh setter
  // every render.
  const setPinnedRef = useRef<(next: boolean) => void>(() => {});
  function setPinned(next: boolean) {
    pinnedRef.current = next;
    setPinnedState(next);
    // Pinning drops this popover's share of `stackHoverCount` to zero, and unpinning recomputes it
    // from where the pointer actually is — both fall out of `syncStackHover` reading `pinnedRef`,
    // with nothing captured at pin time and replayed later. Unpinning by mouse (the pointer resting
    // on the very content the Unpin button lives in, having crossed no boundary and so about to
    // fire no `pointerenter`) puts the share back; unpinning by keyboard with the pointer long
    // since moved on restores nothing, because its regions report nothing to restore.
    //
    // Releasing quietly on the way in matters: the popover is not closing, so the whole-stack leave
    // grace must not arm off it.
    syncStackHover(!next);
  }
  setPinnedRef.current = setPinned;
  const [markPinned] = useState<() => () => void>(() => () => setPinnedRef.current(true));
  const [markUnpinned] = useState<() => () => void>(() => () => setPinnedRef.current(false));
  // A stable getter, so `PopoverContent` can read it through `useSyncExternalStore` without
  // re-subscribing every render. What it reports changes with the registry, not with this closure.
  const [isDeepestPinned] = useState<() => boolean>(
    () => () => isDeepestPinnedEntry(closeSelf),
  );

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
        // The content is on its way out, so its region stops holding the pointer whether or not a
        // `pointerleave` ever arrives for it — and quietly, since a popover closing says nothing
        // about where the pointer went next. Released before `setPinned(false)` below, or unpinning
        // a closing popover would hand its share back to a region that is disappearing. The
        // TRIGGER's region is deliberately untouched: the pointer may well still be resting on it,
        // and that is a real contribution the trigger's own leave will balance.
        releaseContentRegionRef.current();
        // This popover leaves its pinned chain as it closes, so a later unpin of that chain never
        // re-attaches a popover that is no longer on screen — and the level above it inherits the
        // unpin control (`isDeepestPinnedEntry`).
        releasePinnedEntry(closeSelf);
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
      // This popover drops out of whatever pinned chain still holds it, for the same reason the
      // close path above does it: an entry nobody can see must not be reattachable, and the level
      // above it inherits the unpin control.
      releasePinnedEntry(closeSelf);
      // The dwell stack's return/leave timers are module-level (see their own comments) rather than
      // owned by any one popover, so there is no single instance whose unmount alone should clear
      // them — and only a popover that could have SCHEDULED one may cancel one. Two kinds never
      // can, and both unmount routinely while a dwell chain is mid-grace:
      //
      // A non-`dwell` popover schedules neither grace at any point in its life (it closes on its own
      // private `closeTimerRef` instead), so an alert chip's popover unmounting because its run's
      // count dropped to zero this tick, or a Tracker row's dropping out of the list, would
      // otherwise cancel a live dwell chain's pending close — and since the whole-stack grace only
      // ever arms on the transition to zero, nothing would re-arm it and the chain would hang open
      // indefinitely.
      //
      // A `dwell` popover that was PINNED before it unmounts stopped scheduling either grace the
      // moment it was pinned, so it never owns what is pending; a pinned chain and a fresh unpinned
      // one can be live at once, and dismissing the pinned one unmounts every popover in it,
      // each running this same cleanup.
      //
      // What is left — an unpinned `dwell` popover — is the one kind that can actually have
      // scheduled what it is about to cancel, and for it the clear stays safe to over-apply: the
      // worst case is a pending grace not firing, which leaves something open a little longer,
      // never something closing that shouldn't.
      if (dwellRef.current && !pinnedRef.current) {
        cancelReturnClose();
        cancelLeaveClose();
      }
      // Same unmount-under-a-live-pointer gap as the timers above, for `stackHoverCount`: no
      // `pointerleave` ever fires for a trigger that disappears beneath the cursor, so without this
      // an outstanding share this popover held would stay counted forever, permanently blocking the
      // whole-stack leave grace from arming again. Quietly, as ever — this popover vanishing says
      // nothing about where the pointer went. A no-op for a share already given back (a pinned
      // popover's, or a content region released as Radix's `Presence` removed it).
      enteredRegionsRef.current.trigger = false;
      enteredRegionsRef.current.content = false;
      syncStackHover(false);
    },
    // Deliberately only `closeSelf` — this must run on unmount alone, never re-run mid-life on a
    // state or prop change. Everything it touches is a ref or a module-level registry for exactly
    // that reason, `dwell` included (`dwellRef`).
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
    isDeepestPinned,
    pinChain: pinStack,
    unpinChain: () => unpinChainOf(closeSelf),
    markRegionEntered,
    markRegionLeft,
    releaseContentRegion,
    triggerId,
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
        // The name the popover's own dialog falls back to (`PopoverContent`'s `aria-labelledby`)
        // when nothing else names it. Before `{...props}`, so a consumer supplying its own id wins.
        id={popover.triggerId}
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
            // which is exactly why `dwell` is on the context independently of it. Recorded
            // regardless of whether the popover is pinned: this is DOM truth about where the
            // pointer is, and whether it counts towards `stackHoverCount` is derived from the
            // current pin state rather than decided here (see `syncStackHover`).
            if (popover.dwell) popover.markRegionEntered("trigger");
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
              popover.markRegionLeft("trigger");
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
 * and this bar has no value, no label and nothing worth announcing). Renders at 0% width and flips
 * to 100% a commit after mount so the transition actually
 * plays, over `durationMs` — always `DWELL_MS`, the same constant that drives the lock timer in
 * `Popover`, so the bar can never promise a lock at a different moment than the one that arrives.
 * The duration lives only in the inline `transitionDuration` style below, which is real DOM state
 * this component itself sets (readable via `el.style.transitionDuration`, with no stylesheet
 * involved) rather than a bespoke test-only attribute.
 *
 * `motion-reduce:transition-none` drops the animation for a reader who asked for reduced motion:
 * the bar then simply appears full and disappears on lock. The dwell itself is unaffected — the
 * lock timer is what governs when the popover takes the pointer, and this bar only ever reported
 * it.
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
          "h-full bg-accent transition-[width] ease-linear motion-reduce:transition-none",
          filled ? "w-full" : "w-0",
        )}
        style={{ transitionDuration: `${durationMs}ms` }}
      />
    </div>
  );
}

interface PopoverContentProps
  extends Omit<PopoverPrimitive.PopoverContentProps, "side" | "align" | "title"> {
  /** The header region's own heading — optional, unlike the header region itself (see the header
   *  block's own comment below). Earns its place when the trigger is not itself a word (a row, a
   *  bar cell) — nothing else names what the reader is looking at then. A trigger that already IS
   *  the word (a resource name, a building name) keeps repeating it here only where an earlier
   *  design pass already decided to (`DepositPopoverBody`, `BuildingPopoverBody`,
   *  `PotentialYieldPopoverBody`, `NeedPopoverBody`, `TermLabel`'s own definition body) — this prop
   *  does not itself judge whether a new title is warranted. */
  title?: ReactNode;
  /** Extra content on the header row, right of the title — a status figure, a badge — laid out to
   *  the LEFT of the space the header reserves for the pin control, never underneath it. */
  titleMeta?: ReactNode;
}

/** Writes a node to a forwarded ref of either shape, so an element can be handed to a consumer's
 *  ref AND kept on one of the popover's own internal refs (`contentRef`, `triggerRef`) at the same
 *  time. Generic over the element type — `PopoverTrigger` uses it for a button, `PopoverContent`
 *  for a div. */
function assignForwardedRef<T>(ref: ForwardedRef<T>, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/**
 * The popover's own body — the ONLY subtree `focusIntoContent`'s scoped query ever searches (see
 * `FOCUSABLE_IN_POPOVER_BODY`'s own comment), so a nested term trigger inside it is always what
 * ArrowDown reaches first, regardless of where the header (or the pin nested inside it) sits in the
 * DOM.
 *
 * A component rather than a bare `<div>` so that it can OWN the content region's share of the
 * whole-stack hover count. This is the one element that mounts and unmounts exactly with Radix's
 * `Presence` — `PopoverContent` itself stays mounted for the consumer's whole lifetime — and a
 * region removed from under the cursor dispatches no `pointerleave` at all. Escape, or a rival
 * popover taking over while the pointer rests in this content, is exactly that: without the release
 * below the share would be held forever, and since the leave grace only ever arms on the count
 * reaching zero, no dwell popover anywhere in the app would close on pointer-leave again.
 */
function PopoverBody({ children }: { children?: ReactNode }) {
  const { releaseContentRegion } = usePopoverContext("PopoverContent");
  // `releaseContentRegion` has a stable identity for the popover's whole life (see its own comment
  // in `Popover`), so this cleanup runs on unmount and never on a re-render.
  useEffect(() => releaseContentRegion, [releaseContentRegion]);
  return <div data-popover-body>{children}</div>;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className = "",
      sideOffset = 8,
      style,
      title,
      titleMeta,
      onPointerEnter,
      onPointerLeave,
      onOpenAutoFocus,
      onCloseAutoFocus,
      children,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref,
  ) => {
    const popover = usePopoverContext("PopoverContent");
    const { contentRef, pendingEnterRef, dwellState } = popover;
    const titleId = useId();

    /**
     * The dialog's own accessible name. Radix gives `role="dialog"` no name of its own, and a
     * screen reader announcing an unnamed dialog tells the reader only that one opened — so this is
     * decided centrally here rather than left to each call site to remember (which is how every
     * popover but one came to be unnamed).
     *
     * In order: a name the consumer supplied itself always wins; then the header's own title, which
     * is exactly the heading a sighted reader sees; then the trigger, whose text (or its own
     * `aria-label`, for a trigger that is a row or a bar cell rather than a word) is the thing the
     * reader just acted on. `title` is only rendered inside the `dwell` header, so it can only name
     * the dialog when there is a header to render it in.
     */
    const titledByHeader = popover.dwell && title !== undefined;
    const labelledBy =
      ariaLabelledBy ?? (ariaLabel !== undefined ? undefined : titledByHeader ? titleId : popover.triggerId);

    // The depth cue: how far this popover sits from the top of the CURRENT stack, recomputed
    // whenever the registry changes (`subscribeRegistryChange`) rather than only on this
    // popover's own open/close. For a single-level stack (every existing non-`dwell` consumer)
    // `stackLength` is always 1 when open, so `depthFromTop` is always 0 — full opacity, no change.
    // A pinned popover is no longer IN that stack at all — `stackLength` and its own stale `depth`
    // together would compute a meaningless number for it — so it short-circuits to full opacity
    // instead of being run through the maths a live entry uses.
    const stackLength = useSyncExternalStore(subscribeRegistryChange, getStackLength, getStackLength);
    const depthFromTop = Math.max(0, stackLength - 1 - popover.depth);
    const opacity = popover.pinned ? 1 : opacityForDepth(depthFromTop);

    // Whether this popover is the deepest level its own pinned chain still holds — off the same
    // registry subscription, and live rather than frozen at pin time, so dismissing just the
    // deepest level of a pinned chain hands the unpin control down to the next one up instead of
    // leaving the rest of the chain with no affordance but Escape. A separate subscription from
    // `stackLength` above because the two answer different questions off the same store: a pinned
    // chain losing a level need not change `openStack`'s length at all.
    const pinnedIsDeepest = useSyncExternalStore(
      subscribeRegistryChange,
      popover.isDeepestPinned,
      popover.isDeepestPinned,
    );

    // The pin/unpin control renders at exactly one level of a chain, never one per open level: the
    // live top of `openStack` while unpinned (`depthFromTop === 0`), or the deepest level its own
    // chain still holds while pinned. The control follows the pointer down as the chain grows, so
    // there is never a question of which level a click pins or unpins from.
    const showPinControl =
      popover.dwell &&
      dwellState === "locked" &&
      (popover.pinned ? pinnedIsDeepest : depthFromTop === 0);

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
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          // Real state this component decided at open time (`Popover`'s `cursorAnchored`), not a
          // bespoke test hook — which anchor mode is live is exactly what a devtools inspection
          // needs to explain where the popper's own transform is coming from. `undefined` outside
          // `dwell` mode, so the five existing hover-mode consumers carry no such attribute at all.
          data-dwell-anchor={
            dwellState === null ? undefined : popover.cursorAnchored ? "cursor" : "trigger"
          }
          // Marks every popover's outermost element, so the pinned-dismissal guard below can ask
          // "did this click land in another popover?" — the header and its pin control sit outside
          // `[data-popover-body]`, so that marker cannot answer it.
          data-popover-content=""
          onPointerDownOutside={composeHandlers<Parameters<NonNullable<PopoverContentProps["onPointerDownOutside"]>>[0]>(
            props.onPointerDownOutside,
            (event) => {
              // Pinning exists so one chain can be read while another is opened beside it — and
              // opening that second chain's pin is itself a CLICK outside the first, which Radix
              // would otherwise dismiss. That made two pinned chains unreachable by the very
              // gesture meant to produce them. So a pinned popover ignores a pointer-down that
              // lands inside any other popover, and only that: a click on the page background
              // still dismisses it, keeping the ordinary click-away exit everything else has.
              if (!popover.pinned) return;
              const target = event.target;
              if (target instanceof Element && target.closest("[data-popover-content]")) {
                event.preventDefault();
              }
            },
          )}
          style={{ ...style, ...dwellStyle, opacity }}
          onPointerEnter={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerEnter, () => {
            popover.cancelScheduledClose();
            if (!popover.dwell) return;
            // Only a `locked` popover's content ever genuinely receives this — a `filling` one has
            // `pointer-events: none` in a real browser and would never dispatch it in the first
            // place. Gated the same way on both enter and leave (the leave handler below always
            // was, defensively) so the two stay a matched pair: an entered content this component
            // never counted as entered would have nothing for the leave to balance either.
            if (dwellState !== "locked") return;
            // Resting on any `dwell` popover in the stack means the pointer is not off it, whatever
            // depth it is at. Recorded even while pinned — it is DOM truth about where the pointer
            // is, and whether it counts towards `stackHoverCount` is derived from the current pin
            // state (see `syncStackHover`), which is also what makes unpinning by mouse restore the
            // share without any `pointerenter` ever firing.
            popover.markRegionEntered("content");
            // The return grace is the one thing a pinned popover really must not schedule: it has
            // no registry entry left, so it would be closing whatever now occupies the depths it
            // used to hold.
            if (!popover.pinned) scheduleReturnClose(popover.depth);
          })}
          onPointerLeave={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerLeave, () => {
            // The same `dwell`-versus-plain split as `PopoverTrigger`'s own pointer-leave above, and
            // for the reason stated there. A pinned popover runs neither close: it survives until
            // dismissed.
            if (popover.dwell) {
              if (dwellState === "locked") {
                popover.markRegionLeft("content");
                if (popover.pinned) return;
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
            // wants (a `text-xs` caption, a `text-xs` micro-label) stays a deliberate,
            // explicit override on top of this rather than the default itself varying by call site.
            "z-50 w-max max-w-[min(24rem,calc(100vw-2rem))] border border-border-strong border-l-2 border-l-accent bg-surface p-3 text-left text-xs shadow-lg animate-in fade-in-0 zoom-in-95",
            className,
          )}
          {...props}
        >
          {dwellState === "filling" && <DwellBar durationMs={DWELL_MS} />}
          {/* The header region: structural for every `dwell` popover, not a body's opt-in — the pin
             control can only ever appear on a `dwell` popover, so every one of them reserves this
             row's right side for it (a fixed-size slot, always rendered while `popover.dwell`,
             whether or not `showPinControl` currently fills it) rather than each body reserving its
             own gutter (or not) as the earlier `PopoverHeader` component made it. Rendered in
             ORDINARY document order, BEFORE `{children}` — nothing here needs `absolute`
             positioning or a CSS `order` trick to sit visually above the body, because
             `focusIntoContent`/ArrowDown no longer depends on document order to skip it: the query
             it runs is scoped to `[data-popover-body]` (below), which this header and the pin
             inside it are never part of. */}
          {popover.dwell && (
            <div className="mb-1.5 flex items-center gap-3 border-b border-border/60 pb-1">
              {title !== undefined && (
                <span
                  id={titleId}
                  className="whitespace-nowrap font-display font-semibold text-text-primary"
                >
                  {title}
                </span>
              )}
              {titleMeta}
              <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center">
                {showPinControl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconXs"
                    aria-label={popover.pinned ? "Unpin" : "Pin"}
                    aria-pressed={popover.pinned}
                    className={twMerge(popover.pinned && "text-accent hover:text-accent")}
                    onClick={() => (popover.pinned ? popover.unpinChain() : popover.pinChain())}
                  >
                    <PinIcon
                      className="h-3 w-3"
                      aria-hidden="true"
                      fill={popover.pinned ? "currentColor" : "none"}
                    />
                  </Button>
                )}
              </span>
            </div>
          )}
          <PopoverBody>{children}</PopoverBody>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";
