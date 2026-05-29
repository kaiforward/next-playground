"use client";

import { useId } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { choiceRow, formSlots, formSizeVariants } from "./form-slots";

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

interface RadioGroupProps<T extends string> {
  /** Visible heading rendered above the group. Also names the group for AT. */
  label?: string;
  /** Accessible name when no visible `label` is rendered (e.g. an external heading). */
  ariaLabel?: string;
  /** Native radio `name` — must be unique per group on the page. */
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  size?: RadioGroupSize;
}

/**
 * Accessible single-select radio group. Renders a real `radiogroup` whose
 * direct children are `radio`s (sr-only native inputs inside styled labels) —
 * no intervening list markup. The visible affordance is a round indicator
 * pinned to the right of each row; pair with `CheckboxInput` for a consistent
 * control family (same row, square vs round indicator).
 */
export function RadioGroup<T extends string>({
  label,
  ariaLabel,
  name,
  value,
  onChange,
  options,
  size = "sm",
}: RadioGroupProps<T>) {
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
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <label key={option.value} className={radioRowVariants({ active, size })}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="truncate">{option.label}</span>
              <span className={radioDotVariants({ active })} aria-hidden />
            </label>
          );
        })}
      </div>
    </div>
  );
}
