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
 * Popover-based hover card — the second, richer tier beside the plain
 * `Tooltip` (`components/ui/tooltip.tsx`). A tooltip's content is
 * unreachable by keyboard by design; this is built on Radix's Popover
 * instead, so the same trigger opens on hover, click AND keyboard focus,
 * and its content is a real focusable region rather than a description
 * string.
 *
 * Composition mirrors the tooltip wrapper:
 *   <RichCard openDelay={300}>
 *     <RichCardTrigger>{control}</RichCardTrigger>
 *     <RichCardContent>{vitals table, unpin button, ...}</RichCardContent>
 *   </RichCard>
 *
 * Behaviour Radix's Popover does not give for free, implemented here:
 * - Hover-to-open, after `openDelay`, without moving focus (a hover open
 *   must never steal focus off whatever the keyboard user was doing).
 * - A grace period on pointer-leave (of either trigger or content) before
 *   closing, so the pointer can cross the gap between them without the
 *   card closing under it.
 * - Global exclusivity: opening one card closes any other that is open,
 *   via a module-level "who's open" pointer — there is exactly one of
 *   these on screen at a time.
 * - `disableClickOpen` on the root: opts a consumer whose trigger's click
 *   already does something else (e.g. a Tracker row, which navigates on
 *   click) out of Radix's own click-to-toggle, by calling
 *   `event.preventDefault()` before Radix's internal handler runs — hover
 *   and keyboard-focus opens are untouched, since Radix only gates the
 *   click path on it.
 * - The keyboard enter/exit convention below.
 *
 * ## The keyboard convention — every rich card in the game obeys it
 *
 * Opening and entering are two separate steps, because a card describes the
 * thing its trigger already is: the trigger is where the user is, and a
 * card that grabs focus takes them somewhere they did not ask to go. Cards
 * are portalled to the end of the document, so a grabbed focus also puts
 * every element after the trigger behind the card in tab order — in a list
 * of triggers (the Tracker's rows) that makes the list unwalkable.
 *
 * - **Open never moves focus.** Hover, click and keyboard focus all leave
 *   focus on the trigger.
 * - **ArrowDown on the trigger enters the card**, opening it first if it is
 *   closed. Focus lands on the card's first focusable element, or on the
 *   content container itself when the card holds nothing focusable, so the
 *   content is still reachable by a screen reader. The key is consumed, so
 *   the page does not scroll as well.
 * - **Escape closes the card and returns focus to the trigger** — the exit,
 *   and the counterpart of ArrowDown.
 * - **Tab and Shift+Tab cycle within an entered card** rather than leaving
 *   it for the end-of-document void behind it. This is Radix's `FocusScope`
 *   in `loop` mode, which its Popover always enables; nothing here
 *   reimplements it, but it is half of why Escape is a way out and not the
 *   only thing between the user and a dead end.
 * - **A card entered by keyboard is keyboard-driven from then on**, even if
 *   a hover opened it: `enterCard` clears `openedByPointerRef`, so the
 *   close returns focus to the trigger instead of suppressing it.
 *
 * A card whose content itself contains a rich-card trigger inherits all of
 * this recursively, one level per ArrowDown and one per Escape. The one
 * thing that does not yet fit is the exclusivity registry, which would
 * close the outer card as the inner one opened; nesting is out of scope
 * (docs/active/design-system/detail-panels.md) and the registry is where it
 * would start.
 *
 * Escape-to-close is Radix's own default (non-modal) Popover behaviour and
 * is not reimplemented here. Returning focus to the trigger on close is
 * Radix's too, but it is suppressed for a card that was opened by hover and
 * never entered, which never took focus in the first place — see
 * `RichCardContent`.
 */

const DEFAULT_OPEN_DELAY_MS = 300;
const CLOSE_GRACE_MS = 150;

// Module-level "which card is open" pointer. Not React state — it is only
// ever read at the moment a NEW card opens, to close whichever one (if
// any) was already open. Nothing renders off it.
let openCard: (() => void) | null = null;

function claimOpen(closeSelf: () => void) {
  if (openCard && openCard !== closeSelf) openCard();
  openCard = closeSelf;
}

function releaseOpen(closeSelf: () => void) {
  if (openCard === closeSelf) openCard = null;
}

// Focusable-in-a-card selector. Deliberately attribute-based (`:not([disabled])` rather than
// `:not(:disabled)`) so it reads the same in every DOM implementation the tests run in.
const FOCUSABLE_IN_CARD = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The one way focus ever gets into a card — both the "open it, then enter" and the "already open,
 * enter" paths run through here, so entering cannot mean two different things depending on what
 * the card's state was.
 *
 * A card with nothing focusable inside still has to be reachable, or its content is invisible to a
 * screen reader driven by the keyboard; focus falls back to the content container, which Radix's
 * `FocusScope` gives a `tabIndex` of -1 (programmatically focusable, never in the tab order).
 */
function focusIntoContent(content: HTMLElement | null) {
  const first = content?.querySelector<HTMLElement>(FOCUSABLE_IN_CARD);
  (first ?? content)?.focus();
}

function composeHandlers<E>(
  ...handlers: Array<((event: E) => void) | undefined>
): (event: E) => void {
  return (event) => {
    for (const handler of handlers) handler?.(event);
  };
}

interface RichCardContextValue {
  open: boolean;
  side: PopoverPrimitive.PopoverContentProps["side"];
  align: PopoverPrimitive.PopoverContentProps["align"];
  disableClickOpen: boolean;
  openedByPointerRef: MutableRefObject<boolean>;
  suppressNextTriggerFocusRef: MutableRefObject<boolean>;
  /** The content element while the card is open, null while it is closed — the target the
   *  trigger's ArrowDown focuses into, and what tells the close grace period that the keyboard
   *  is currently inside this card. Written by `RichCardContent`. */
  contentRef: MutableRefObject<HTMLDivElement | null>;
  /** An enter asked for before the content existed: `enterCard` raises it, the content lowers it
   *  as it mounts and takes the focus. */
  pendingEnterRef: MutableRefObject<boolean>;
  scheduleOpen: () => void;
  cancelScheduledOpen: () => void;
  openViaFocus: () => void;
  enterCard: () => void;
  scheduleClose: () => void;
  cancelScheduledClose: () => void;
}

const RichCardContext = createContext<RichCardContextValue | null>(null);

function useRichCardContext(component: string): RichCardContextValue {
  const context = useContext(RichCardContext);
  if (!context) {
    throw new Error(`${component} must be rendered inside <RichCard>.`);
  }
  return context;
}

export interface RichCardProps {
  /** Hover-open delay in ms. Click and keyboard focus ignore this. */
  openDelay?: number;
  side?: PopoverPrimitive.PopoverContentProps["side"];
  align?: PopoverPrimitive.PopoverContentProps["align"];
  /**
   * Opts out of click-to-open. Set when the trigger's click already has a job (e.g. a Tracker row
   * navigates on click) so the same gesture doesn't also open the card. Hover-open and
   * keyboard-focus-open are unaffected — this suppresses only Radix's built-in click toggle.
   */
  disableClickOpen?: boolean;
  children: ReactNode;
}

export function RichCard({
  openDelay = DEFAULT_OPEN_DELAY_MS,
  side = "bottom",
  align = "center",
  disableClickOpen = false,
  children,
}: RichCardProps) {
  const [open, setOpenState] = useState(false);
  const openedByPointerRef = useRef(false);
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
    } else {
      releaseOpen(closeSelf);
      // Neither `openedByPointerRef` nor the suppress-focus flag is touched
      // here. Both are settled in `RichCardContent`'s `onCloseAutoFocus` —
      // which Radix dispatches a beat AFTER this, and which still needs to
      // know how the card that is closing was opened. Every open path
      // rewrites `openedByPointerRef` for itself, so nothing is left stale.
    }
    setOpenState(next);
  }
  setOpenRef.current = setOpen;

  // Rows unmount routinely under a live pointer (the Tracker's query is
  // invalidated every economy cycle), and React fires no `pointerleave`
  // for an element that disappears beneath the cursor — so nothing else
  // would ever clear these. A surviving open timer is the damaging one:
  // it fires after this card is gone, claims the exclusivity registry and
  // closes whichever card the user is actually reading. `releaseOpen` is
  // reference-guarded, so it is a no-op for a card that never claimed —
  // it must never blank a claim another card now holds.
  useEffect(
    () => () => {
      if (openTimerRef.current !== null) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      releaseOpen(closeSelf);
    },
    [closeSelf],
  );

  function scheduleOpen() {
    if (open) return;
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      openedByPointerRef.current = true;
      setOpen(true);
    }, openDelay);
  }

  function cancelScheduledOpen() {
    clearOpenTimer();
  }

  function openViaFocus() {
    clearOpenTimer();
    openedByPointerRef.current = false;
    setOpen(true);
  }

  /**
   * ArrowDown from the trigger: the deliberate way in. Opens the card first if it is closed —
   * focus cannot move into content that does not exist yet, so the intent is parked on
   * `pendingEnterRef` and the content picks it up as it mounts.
   */
  function enterCard() {
    cancelScheduledOpen();
    cancelScheduledClose();
    // Whatever opened this card, the keyboard is driving it now. `openedByPointerRef` gates the
    // close-side focus return: left set, Escape would drop focus to the document body instead of
    // handing it back to the trigger the user came from.
    openedByPointerRef.current = false;
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
      // The pointer wandering off never closes a card the keyboard is inside. The user stopped
      // driving with the pointer the moment they entered; closing here would yank the card out
      // from under them mid-read. Escape is their way out. Checked as the grace period expires,
      // not when it was scheduled, because the enter can happen inside that window.
      if (contentRef.current?.contains(document.activeElement)) return;
      setOpen(false);
    }, CLOSE_GRACE_MS);
  }

  function cancelScheduledClose() {
    clearCloseTimer();
  }

  const context: RichCardContextValue = {
    open,
    side,
    align,
    disableClickOpen,
    openedByPointerRef,
    suppressNextTriggerFocusRef,
    contentRef,
    pendingEnterRef,
    scheduleOpen,
    cancelScheduledOpen,
    openViaFocus,
    enterCard,
    scheduleClose,
    cancelScheduledClose,
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <RichCardContext.Provider value={context}>{children}</RichCardContext.Provider>
    </PopoverPrimitive.Root>
  );
}

/**
 * Trigger for a rich card, `asChild` like the tooltip trigger — wrap a
 * single interactive element (a row, a button, an icon). Wires pointer
 * hover (with the root's `openDelay`), click, keyboard focus and the
 * ArrowDown that enters the card, without disturbing whatever handlers the
 * wrapped element already carries.
 */
export const RichCardTrigger = forwardRef<
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
    const richCard = useRichCardContext("RichCardTrigger");
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
        onPointerEnter={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerEnter,
          () => {
            richCard.cancelScheduledClose();
            richCard.scheduleOpen();
          },
        )}
        onPointerLeave={composeHandlers<React.PointerEvent<HTMLButtonElement>>(
          onPointerLeave,
          () => {
            pointerActiveRef.current = false;
            richCard.cancelScheduledOpen();
            if (richCard.open) richCard.scheduleClose();
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
          if (richCard.suppressNextTriggerFocusRef.current) {
            // Radix returning focus here after a close, not a real Tab press.
            richCard.suppressNextTriggerFocusRef.current = false;
            return;
          }
          if (pointerActiveRef.current) return;
          richCard.cancelScheduledOpen();
          richCard.openViaFocus();
        })}
        onKeyDown={composeHandlers<React.KeyboardEvent<HTMLButtonElement>>(onKeyDown, (event) => {
          // ArrowDown is the way in — see the convention in RichCard's docblock. Bare only: a
          // modified ArrowDown belongs to the browser (and Alt+Down is a native combobox gesture
          // on some platforms). A wrapped element that already handled the key keeps it.
          if (event.key !== "ArrowDown" || event.defaultPrevented) return;
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          // Consumed, so the page behind the card does not scroll on the same press.
          event.preventDefault();
          richCard.enterCard();
        })}
        onClick={composeHandlers<React.MouseEvent<HTMLButtonElement>>(onClick, (event) => {
          pointerActiveRef.current = false;
          richCard.openedByPointerRef.current = false;
          richCard.cancelScheduledOpen();
          // Radix's own Trigger composes ITS click-toggle after this handler and skips it once
          // the event is marked defaultPrevented (see RichCard's docblock) — this is the only line
          // `disableClickOpen` adds.
          if (richCard.disableClickOpen) event.preventDefault();
        })}
        {...props}
      />
    );
  },
);
RichCardTrigger.displayName = "RichCardTrigger";

interface RichCardContentProps
  extends Omit<PopoverPrimitive.PopoverContentProps, "side" | "align"> {}

/** Writes a node to a forwarded ref of either shape, so the content element can be handed to a
 *  consumer's ref AND kept on the card's own `contentRef` at the same time. */
function assignForwardedRef(ref: ForwardedRef<HTMLDivElement>, node: HTMLDivElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const RichCardContent = forwardRef<HTMLDivElement, RichCardContentProps>(
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
    const richCard = useRichCardContext("RichCardContent");
    const { contentRef, pendingEnterRef } = richCard;

    // Attaching the content element is also where an enter that had to open the card first gets
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
          side={richCard.side}
          align={richCard.align}
          sideOffset={sideOffset}
          onPointerEnter={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerEnter, () => {
            richCard.cancelScheduledClose();
          })}
          onPointerLeave={composeHandlers<React.PointerEvent<HTMLDivElement>>(onPointerLeave, () => {
            richCard.scheduleClose();
          })}
          onOpenAutoFocus={composeHandlers<Event>(onOpenAutoFocus, (event) => {
            // The card NEVER takes focus, however it was opened. A rich card describes the thing
            // its trigger already is, so focus belongs on the trigger: these triggers are rows in
            // a list, and the content is portalled to the end of the document, so a card that
            // takes focus puts every remaining row behind it in tab order — the next Tab has
            // nowhere to go and focus sticks on whatever the card contains.
            //
            // Controls inside a card are not lost to the keyboard by this: they are reached by a
            // deliberate way IN — ArrowDown on the trigger — rather than by a focus grab that
            // breaks walking the list. That enter is `focusIntoContent`, called from the trigger
            // or from `setContentNode` above, so opening and entering stay two separate steps
            // even when one ArrowDown does both.
            event.preventDefault();
          })}
          onCloseAutoFocus={composeHandlers<Event>(onCloseAutoFocus, (event) => {
            const openedByPointer = richCard.openedByPointerRef.current;
            richCard.openedByPointerRef.current = false;
            if (openedByPointer) {
              // A hover-opened card never took focus — `onOpenAutoFocus`
              // above suppresses that — so there is nothing to hand back,
              // and handing it back anyway is destructive: the focus lands
              // on this trigger, and a `focusin` outside the card that has
              // just taken over is enough for Radix to dismiss THAT card.
              // Hovering from one row to the next would open the second card
              // and shut it again in the same frame. This is the close-side
              // half of the open-side focus suppression. A hover-opened card
              // the user then ENTERS is no longer one of these: `enterCard`
              // clears the flag, so it closes down the keyboard path below
              // and hands focus back to its trigger.
              event.preventDefault();
              return;
            }
            // The only moment Radix may hand focus back to the trigger. Its
            // non-modal Content calls this handler first, then focuses the
            // trigger synchronously — but only when the close did NOT come
            // from an interaction outside the card. That programmatic focus
            // is indistinguishable, at the trigger's `onFocus`, from a real
            // Tab press, and would reopen the card that just closed.
            //
            // So the flag is raised here and lowered again on the microtask
            // that follows this dispatch: any focus Radix returns lands
            // inside it, and any later, genuine Tab does not. Setting it at
            // close time instead left it raised forever whenever Radix chose
            // not to return focus — swallowing one real Tab-to-open, which
            // reads as flakiness rather than as a bug.
            richCard.suppressNextTriggerFocusRef.current = true;
            queueMicrotask(() => {
              richCard.suppressNextTriggerFocusRef.current = false;
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
RichCardContent.displayName = "RichCardContent";
