"use client";

import { tv, type VariantProps } from "tailwind-variants";
import {
  RadioOptionGroup,
  type RadioOptionGroupBaseProps,
} from "./radio-option-group";

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
      sm: "px-2 py-1 text-xs",
      md: "px-2 py-1 text-xs",
    },
  },
  defaultVariants: { size: "sm" },
});

type SegmentedSize = VariantProps<typeof segmentVariants>["size"];

interface SegmentedControlProps<T extends string> extends RadioOptionGroupBaseProps<T> {
  size?: SegmentedSize;
}

/**
 * Joined segmented control — a single-select laid out as one horizontal bar of equal-width segments
 * with the active segment filled. A skin over {@link RadioOptionGroup}, so it carries the same radio
 * semantics as {@link RadioGroup}. Use for compact mutually-exclusive toggles (buy/sell,
 * all/buy/sell) where the vertical {@link RadioGroup} rows are too heavy.
 */
export function SegmentedControl<T extends string>({
  size = "sm",
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioOptionGroup
      {...props}
      size={size}
      groupClassName="flex"
      optionClassName={(active) => segmentVariants({ active, size })}
      tooltipSide="top"
    />
  );
}
