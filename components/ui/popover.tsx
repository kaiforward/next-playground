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
  type ComponentPropsWithoutRef,
  type ForwardedRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

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
 * - Global exclusivity: opening one popover closes any other that is open,
 *   via a module-level "who's open" pointer — there is exactly one of
 *   these on screen at a time.
 * - `disableClickOpen` on the root: opts a consumer whose trigger's click
 *   already does something else (e.g. a Tracker row, which navigates on
 *   click) out of Radix's own click-to-toggle, by calling
 *   `event.preventDefault()` before Radix's internal handler runs — hover
 *   and keyboard-focus opens are untouched, since Radix only gates the
 *   click path on it.
 * - `disableHoverOpen` on the root: the same opt-out for the hover path,
 *   for a consumer whose trigger hover already means something else (an
 *   alert chip's raises it clear of an overlapped run) or whose triggers
 *   sit close enough that sweeping across them would open each in turn.
 *   It suppresses only the hover timer — click and keyboard focus still
 *   open, so nothing below changes.
 * - The keyboard enter/exit convention below.
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
 * this recursively, one level per ArrowDown and one per Escape. The one
 * thing that does not yet fit is the exclusivity registry, which would
 * close the outer popover as the inner one opened; nesting is out of scope
 * (docs/active/design-system/detail-panels.md) and the registry is where it
 * would start.
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

// Module-level "which popover is open" pointer. Not React state — it is only
// ever read at the moment a NEW popover opens, to close whichever one (if
// any) was already open. Nothing renders off it.
let openPopover: (() => void) | null = null;

// True only for the instant `claimOpen` spends closing the popover that was
// already open. The popover being closed runs its own `setOpen(false)` inside
// that call, synchronously, which is the one moment it can tell "another
// popover is taking over" apart from every other reason it might be closing —
// and the difference decides whether it hands focus back to its trigger,
// because a focus landing outside the incoming popover dismisses it on sight.
let takeoverInProgress = false;

function claimOpen(closeSelf: () => void) {
  if (openPopover && openPopover !== closeSelf) {
    takeoverInProgress = true;
    try {
      openPopover();
    } finally {
      takeoverInProgress = false;
    }
  }
  openPopover = closeSelf;
}

function releaseOpen(closeSelf: () => void) {
  if (openPopover === closeSelf) openPopover = null;
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
  /** Another popover claimed the exclusivity registry; this one is closing to make room for it. */
  takeover: boolean;
}

interface PopoverContextValue {
  open: boolean;
  side: PopoverPrimitive.PopoverContentProps["side"];
  align: PopoverPrimitive.PopoverContentProps["align"];
  disableClickOpen: boolean;
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

export interface PopoverProps {
  /** Hover-open delay in ms. Click and keyboard focus ignore this. */
  openDelay?: number;
  side?: PopoverPrimitive.PopoverContentProps["side"];
  align?: PopoverPrimitive.PopoverContentProps["align"];
  /**
   * Opts out of click-to-open. Set when the trigger's click already has a job (e.g. a Tracker row
   * navigates on click) so the same gesture doesn't also open the popover. Hover-open and
   * keyboard-focus-open are unaffected — this suppresses only Radix's built-in click toggle.
   */
  disableClickOpen?: boolean;
  /**
   * Opts out of hover-to-open. Set when the trigger's hover already means something else — an alert
   * chip's does, raising it clear of the overlapped run — or when triggers sit close enough together
   * that sweeping the pointer across them would open one after another. Click-open and
   * keyboard-focus-open are unaffected: this suppresses only the hover timer, so the popover is still
   * reachable by every other route and the keyboard convention below is untouched.
   */
  disableHoverOpen?: boolean;
  children: ReactNode;
}

export function Popover({
  openDelay = DEFAULT_OPEN_DELAY_MS,
  side = "bottom",
  align = "center",
  disableClickOpen = false,
  disableHoverOpen = false,
  children,
}: PopoverProps) {
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

  // `closeSelf` needs a stable identity for the whole component's
  // lifetime — the exclusivity registry above compares it by reference,
  // and the unmount cleanup below releases the claim by that same
  // reference — while `setOpen` is a fresh function every render.
  // `setOpenRef` bridges the two: reassigned every render, read through
  // the one stable closure the registry holds.
  const setOpenRef = useRef<(next: boolean) => void>(() => {});
  const [closeSelf] = useState<() => void>(() => () => setOpenRef.current(false));

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
      claimOpen(closeSelf);
      // A fresh session records nothing yet, so a content unmount partway through one — a Tracker
      // row dropping out of the list under an open popover — can never replay the previous close's
      // decision and pull focus onto a trigger that is going away too.
      closeReasonRef.current = { entered: false, takeover: false };
    } else {
      releaseOpen(closeSelf);
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
      releaseOpen(closeSelf);
    },
    [closeSelf],
  );

  function scheduleOpen() {
    // The hover path, and only the hover path, runs through here — click and keyboard focus open
    // directly rather than on a timer, which is what lets one opt-out suppress hover alone.
    if (disableHoverOpen) return;
    if (open) return;
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => setOpen(true), openDelay);
  }

  function cancelScheduledOpen() {
    clearOpenTimer();
  }

  function openViaFocus() {
    clearOpenTimer();
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
    disableClickOpen,
    closeReasonRef,
    suppressNextTriggerFocusRef,
    contentRef,
    pendingEnterRef,
    scheduleOpen,
    cancelScheduledOpen,
    openViaFocus,
    enterPopover,
    scheduleClose,
    cancelScheduledClose,
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverContext.Provider value={context}>{children}</PopoverContext.Provider>
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

    return (
      <PopoverPrimitive.Trigger
        asChild
        ref={forwardedRef}
        // The gesture is announced rather than left to be discovered: a screen reader reads the
        // shortcut with the trigger's own name, which is the only place a keyboard user would
        // learn that this row has a popover and how to get into it. Before `{...props}`, so a
        // consumer with a different gesture can still say so.
        aria-keyshortcuts="ArrowDown"
        onPointerEnter={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerEnter,
          () => {
            popover.cancelScheduledClose();
            popover.scheduleOpen();
          },
        )}
        onPointerLeave={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerLeave,
          () => {
            pointerActiveRef.current = false;
            popover.cancelScheduledOpen();
            if (popover.open) popover.scheduleClose();
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
          // ArrowDown is the way in — see the convention in Popover's docblock. Bare only: a
          // modified ArrowDown belongs to the browser (and Alt+Down is a native combobox gesture
          // on some platforms). A wrapped element that already handled the key keeps it.
          if (event.key !== "ArrowDown" || event.defaultPrevented) return;
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          // Consumed, so the page behind the popover does not scroll on the same press.
          event.preventDefault();
          popover.enterPopover();
        })}
        onClick={composeHandlers<React.MouseEvent<HTMLButtonElement>>(onClick, (event) => {
          pointerActiveRef.current = false;
          popover.cancelScheduledOpen();
          // Radix's own Trigger composes ITS click-toggle after this handler and skips it once
          // the event is marked defaultPrevented (see Popover's docblock) — this is the only line
          // `disableClickOpen` adds.
          if (popover.disableClickOpen) event.preventDefault();
        })}
        {...props}
      />
    );
  },
);
PopoverTrigger.displayName = "PopoverTrigger";

interface PopoverContentProps
  extends Omit<PopoverPrimitive.PopoverContentProps, "side" | "align"> {}

/** Writes a node to a forwarded ref of either shape, so the content element can be handed to a
 *  consumer's ref AND kept on the popover's own `contentRef` at the same time. */
function assignForwardedRef(ref: ForwardedRef<HTMLDivElement>, node: HTMLDivElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className = "",
      sideOffset = 8,
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
    const { contentRef, pendingEnterRef } = popover;

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
          sideOffset={sideOffset}
          onPointerEnter={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerEnter, () => {
            popover.cancelScheduledClose();
          })}
          onPointerLeave={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerLeave, () => {
            popover.scheduleClose();
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
            "z-50 w-64 border border-border-strong border-l-2 border-l-accent bg-surface p-3 text-left shadow-lg animate-in fade-in-0 zoom-in-95",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";
