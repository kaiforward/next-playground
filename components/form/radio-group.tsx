"use client";

import { tv, type VariantProps } from "tailwind-variants";
import { choiceRow } from "./form-slots";
import {
  RadioOptionGroup,
  type RadioOptionGroupBaseProps,
} from "./radio-option-group";

const radioRowVariants = tv({
  base: choiceRow.base,
  variants: {
    active: choiceRow.active,
    size: choiceRow.size,
  },
  defaultVariants: { size: "sm" },
});

// Round indicator (pinned right) — distinguishes radios from the square
// checkbox indicator. Copper accent + glow when selected, dim dot otherwise.
const radioDotVariants = tv({
  base: "ml-auto h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-150",
  variants: {
    active: {
      true: "bg-accent shadow-[0_0_6px_var(--color-accent)]",
      false: "bg-border-strong",
    },
  },
});

type RadioGroupSize = VariantProps<typeof radioRowVariants>["size"];

interface RadioGroupProps<T extends string> extends RadioOptionGroupBaseProps<T> {
  size?: RadioGroupSize;
}

/**
 * Accessible single-select radio group — the vertical skin over {@link RadioOptionGroup}, which owns
 * the radio semantics. The visible affordance is a round indicator pinned to the right of each row;
 * pair with `CheckboxInput` for a consistent control family (same row, square vs round indicator).
 */
export function RadioGroup<T extends string>({
  size = "sm",
  ...props
}: RadioGroupProps<T>) {
  return (
    <RadioOptionGroup
      {...props}
      size={size}
      optionClassName={(active) => radioRowVariants({ active, size })}
      optionLabelClassName="truncate"
      indicator={(active) => (
        <span className={radioDotVariants({ active })} aria-hidden />
      )}
      tooltipSide="right"
    />
  );
}
