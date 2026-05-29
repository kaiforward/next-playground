"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef } from "react";

/**
 * Accessible tooltip wrapper over Radix. Radix wires `aria-describedby` from
 * trigger → content, reveals on hover AND keyboard focus (and touch), closes on
 * Escape/blur, and portals the content out of the DOM flow — so it never grows
 * its container or nests block content inside an interactive trigger.
 *
 * Wrap a region in `<TooltipProvider>` once, then per tooltip:
 *   <Tooltip><TooltipTrigger asChild>{control}</TooltipTrigger>
 *     <TooltipContent>{legend}</TooltipContent></Tooltip>
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  HTMLDivElement,
  TooltipPrimitive.TooltipContentProps
>(({ className = "", sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={`z-50 w-44 border border-border bg-surface px-2 py-1.5 text-left shadow-lg animate-in fade-in-0 zoom-in-95 ${className}`}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-surface" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";
