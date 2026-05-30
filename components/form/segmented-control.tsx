"use client";

import { Fragment, useId, type ReactNode } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { formSlots, formSizeVariants } from "./form-slots";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Joined segmented control: equal-width segments share one border frame
// (collapsed via -ml-px), the active segment filled with the copper accent and
// raised over its neighbours so its accent border reads as a single outline.
// Sharp corners per Foundry — this is the HTML UI, not the WebGL map.
const segmentVariants = tv({
  base: [
    "relative flex-1 cursor-pointer select-none text-center",
    "font-medium uppercase tracking-wider",
    "border border-border -ml-px first:ml-0",
    "transition-colors duration-150",
    "focus:outline-none",
    "has-[:focus-visible]:z-10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
  ],
  variants: {
    active: {
      true: "z-10 border-accent/60 bg-accent/20 text-text-accent",
      false:
        "bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary",
    },
    size: {
      sm: "px-2 py-1 text-[10px]",
      md: "px-2 py-1 text-xs",
    },
  },
  defaultVariants: { size: "sm" },
});

type SegmentedSize = VariantProps<typeof segmentVariants>["size"];

interface SegmentedControlProps<T extends string> {
  /** Visible heading rendered above the group. Also names the group for AT. */
  label?: string;
  /** Accessible name when no visible `label` is rendered (e.g. an external heading). */
  ariaLabel?: string;
  /** Native radio `name` — must be unique per group on the page. */
  name: string;
  value: T;
  onChange: (value: T) => void;
  /**
   * Each option may carry an optional `tooltip` legend, revealed on
   * hover/keyboard-focus of that segment (requires an ancestor `TooltipProvider`).
   */
  options: ReadonlyArray<{ value: T; label: string; tooltip?: ReactNode }>;
  size?: SegmentedSize;
}

/**
 * Joined segmented control — a single-select laid out as one horizontal bar of
 * equal-width segments with the active segment filled. Under the hood it uses
 * the same radio semantics as {@link RadioGroup} (sr-only native radios inside
 * styled labels, wrapped in a `radiogroup`), so it gets arrow-key navigation
 * and correct screen-reader announcements ("radio, selected") for free — no
 * hand-rolled `aria-pressed`. Use for compact mutually-exclusive toggles
 * (buy/sell, all/buy/sell) where the vertical {@link RadioGroup} rows are too
 * heavy. An option with a `tooltip` wraps its segment in a Radix tooltip
 * (no permanent height) — the segment stays a direct child of the group since
 * the trigger renders `asChild`.
 */
export function SegmentedControl<T extends string>({
  label,
  ariaLabel,
  name,
  value,
  onChange,
  options,
  size = "sm",
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const labelSlot = label
    ? `${formSlots.label} ${formSizeVariants[size].label}`
    : undefined;

  return (
    <div>
      {label && (
        <span id={groupId} className={labelSlot}>
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? groupId : undefined}
        className="flex"
      >
        {options.map((option) => {
          const active = option.value === value;
          const segment = (
            <label className={segmentVariants({ active, size })}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span>{option.label}</span>
            </label>
          );

          if (!option.tooltip) {
            return <Fragment key={option.value}>{segment}</Fragment>;
          }

          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>{segment}</TooltipTrigger>
              <TooltipContent side="top">{option.tooltip}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
