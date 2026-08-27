"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { tv } from "tailwind-variants";

/**
 * Accessible tooltip wrapper over Radix. Radix wires `aria-describedby` from
 * trigger → content, reveals on hover AND keyboard focus (and touch), closes on
 * Escape/blur, and portals the content out of the DOM flow — so it never grows
 * its container or nests block content inside an interactive trigger.
 *
 * A single app-wide `<TooltipProvider>` is mounted near the root (in
 * `client/main.tsx`) — consumers don't add their own, just use:
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
 * panels can't drift; pass `className` to override what a call site genuinely needs.
 * Controls with supplemental legend tooltips (checkboxes, segments, radios)
 * use the bare `TooltipTrigger` and stay unmarked — see theme.md.
 */
const triggerLabelStyles = tv({
  // `[text-transform:inherit]` because a browser does not pass text-transform down into a
  // form control: a trigger sitting inside an uppercased label (a `SectionHeader`, a
  // table's `<th>`) would otherwise render mixed-case while the labels either side of it
  // shout, which reads as a styling bug rather than as a link. Inheriting is the right
  // default in every context — outside an uppercased one it resolves to none and changes
  // nothing.
  base: "text-left [text-transform:inherit] underline decoration-dotted decoration-1 decoration-text-tertiary/75 underline-offset-[3px] hover:decoration-solid hover:decoration-text-secondary",
});

export function TooltipTriggerLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<"button">) {
  return (
    <TooltipPrimitive.Trigger asChild>
      <button type="button" className={triggerLabelStyles({ className })} {...props} />
    </TooltipPrimitive.Trigger>
  );
}

const contentStyles = tv({
  base: "z-50 w-44 border border-border bg-surface px-2 py-1.5 text-left shadow-lg animate-in fade-in-0 zoom-in-95",
});

export const TooltipContent = forwardRef<
  HTMLDivElement,
  TooltipPrimitive.TooltipContentProps
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={contentStyles({ className })}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-surface" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";
