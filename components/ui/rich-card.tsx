"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  createContext,
  forwardRef,
  useContext,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
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
 * - Click and keyboard-focus both open immediately AND move focus into the
 *   content — Radix's default `onOpenAutoFocus` already does this; hover
 *   opens are the one case that suppresses it (`openedByPointerRef`).
 * - A grace period on pointer-leave (of either trigger or content) before
 *   closing, so the pointer can cross the gap between them without the
 *   card closing under it.
 * - Global exclusivity: opening one card closes any other that is open,
 *   via a module-level "who's open" pointer — there is exactly one of
 *   these on screen at a time.
 *
 * Escape-to-close and returning focus to the trigger on close are Radix's
 * own default (non-modal) Popover behaviour and are not reimplemented
 * here.
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
  openedByPointerRef: MutableRefObject<boolean>;
  suppressNextTriggerFocusRef: MutableRefObject<boolean>;
  scheduleOpen: () => void;
  cancelScheduledOpen: () => void;
  openViaFocus: () => void;
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
  children: ReactNode;
}

export function RichCard({
  openDelay = DEFAULT_OPEN_DELAY_MS,
  side = "bottom",
  align = "center",
  children,
}: RichCardProps) {
  const [open, setOpenState] = useState(false);
  const openedByPointerRef = useRef(false);
  const suppressNextTriggerFocusRef = useRef(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `closeSelf` needs a stable identity for the whole component's
  // lifetime — the exclusivity registry above compares it by reference —
  // but it must always run the LATEST `setOpen` (which closes over the
  // current `open` value, needed for the suppress-focus bookkeeping
  // below). `setOpenRef` bridges the two: reassigned every render, read
  // through the one stable closure the registry holds.
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
      openedByPointerRef.current = false;
      // Radix returns focus to the trigger on close (Escape, outside
      // click/focus, or losing exclusivity to another card). Without this
      // flag, that programmatic focus lands on the trigger's `onFocus`
      // handler indistinguishable from a real Tab press and reopens the
      // card it just closed. Consumed by the very next trigger focus.
      if (open) suppressNextTriggerFocusRef.current = true;
    }
    setOpenState(next);
  }
  setOpenRef.current = setOpen;

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

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_GRACE_MS);
  }

  function cancelScheduledClose() {
    clearCloseTimer();
  }

  const context: RichCardContextValue = {
    open,
    side,
    align,
    openedByPointerRef,
    suppressNextTriggerFocusRef,
    scheduleOpen,
    cancelScheduledOpen,
    openViaFocus,
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
 * hover (with the root's `openDelay`), click, and keyboard focus without
 * disturbing whatever handlers the wrapped element already carries.
 */
export const RichCardTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ onPointerEnter, onPointerLeave, onPointerDown, onFocus, onClick, ...props }, forwardedRef) => {
  const richCard = useRichCardContext("RichCardTrigger");
  // Local to this trigger: distinguishes a focus event caused by a mouse
  // press (which `onClick`/Radix's own toggle will open) from a genuine
  // keyboard (Tab) focus, which this component must open on its own.
  const pointerActiveRef = useRef(false);

  return (
    <PopoverPrimitive.Trigger
      asChild
      ref={forwardedRef}
      onPointerEnter={composeHandlers<React.PointerEvent<HTMLButtonElement>>(onPointerEnter, () => {
        richCard.cancelScheduledClose();
        richCard.scheduleOpen();
      })}
      onPointerLeave={composeHandlers<React.PointerEvent<HTMLButtonElement>>(onPointerLeave, () => {
        richCard.cancelScheduledOpen();
        if (richCard.open) richCard.scheduleClose();
      })}
      onPointerDown={composeHandlers<React.PointerEvent<HTMLButtonElement>>(onPointerDown, () => {
        pointerActiveRef.current = true;
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
      onClick={composeHandlers<React.MouseEvent<HTMLButtonElement>>(onClick, () => {
        pointerActiveRef.current = false;
        richCard.openedByPointerRef.current = false;
        richCard.cancelScheduledOpen();
      })}
      {...props}
    />
  );
});
RichCardTrigger.displayName = "RichCardTrigger";

interface RichCardContentProps
  extends Omit<PopoverPrimitive.PopoverContentProps, "side" | "align"> {}

export const RichCardContent = forwardRef<HTMLDivElement, RichCardContentProps>(
  ({ className = "", sideOffset = 8, onPointerEnter, onPointerLeave, onOpenAutoFocus, children, ...props }, ref) => {
    const richCard = useRichCardContext("RichCardContent");
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
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
            if (richCard.openedByPointerRef.current) event.preventDefault();
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
