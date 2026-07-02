"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Accessible tooltip wrapper over Radix. Radix wires `aria-describedby` from
 * trigger → content, reveals on hover AND keyboard focus (and touch), closes on
 * Escape/blur, and portals the content out of the DOM flow — so it never grows
 * its container or nests block content inside an interactive trigger.
 *
 * A single app-wide `<TooltipProvider>` is mounted near the root (in
 * `app/(game)/layout.tsx`) — consumers don't add their own, just use:
 *   <Tooltip><TooltipTrigger asChild>{control}</TooltipTrigger>
 *     <TooltipContent>{legend}</TooltipContent></Tooltip>
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Trigger for a plain-text label whose tooltip is the payload (good names,
 * building names, labour chips, prose keywords). Carries the app-wide
 * "tooltip here" affordance — dotted underline, solid on hover — baked in so
 * panels can't drift; pass `className` for layout only, never decoration.
 * Controls with supplemental legend tooltips (checkboxes, segments, radios)
 * use the bare `TooltipTrigger` and stay unmarked — see theme.md.
 */
export function TooltipTriggerLabel({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <TooltipPrimitive.Trigger asChild>
      <button
        type="button"
        className={twMerge(
          "text-left underline decoration-dotted decoration-1 decoration-text-tertiary/75 underline-offset-[3px] hover:decoration-solid hover:decoration-text-secondary",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Trigger>
  );
}

export const TooltipContent = forwardRef<
  HTMLDivElement,
  TooltipPrimitive.TooltipContentProps
>(({ className = "", sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={twMerge(
        "z-50 w-44 border border-border bg-surface px-2 py-1.5 text-left shadow-lg animate-in fade-in-0 zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-surface" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";
