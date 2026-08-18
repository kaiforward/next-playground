"use client";

import { Fragment, useId, type ComponentProps, type ReactNode } from "react";
import { formSlots, formSizeVariants } from "./form-slots";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The two label scales the form family styles headings at (see `formSizeVariants`). */
export type RadioOptionSize = "sm" | "md";

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** Optional legend, revealed on hover/keyboard-focus of the option (needs an ancestor `TooltipProvider`). */
  tooltip?: ReactNode;
}

/** Props every skin re-exposes verbatim — the single-select contract itself. */
export interface RadioOptionGroupBaseProps<T extends string> {
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
   * hover/keyboard-focus of that option (requires an ancestor `TooltipProvider`).
   */
  options: ReadonlyArray<RadioOption<T>>;
}

interface RadioOptionGroupProps<T extends string> extends RadioOptionGroupBaseProps<T> {
  size: RadioOptionSize;
  /** Layout classes for the `radiogroup` element — e.g. a joined horizontal bar. */
  groupClassName?: string;
  /** Classes for one option's `<label>`, given whether it is the selected one. */
  optionClassName: (active: boolean) => string;
  /** Classes for the option's text span — e.g. `truncate` where the row is width-constrained. */
  optionLabelClassName?: string;
  /** Rendered after the option text inside the row: the skin's selection affordance, if it has one. */
  indicator?: (active: boolean) => ReactNode;
  /** Side the tooltip opens on, chosen by the skin's layout direction. */
  tooltipSide: NonNullable<ComponentProps<typeof TooltipContent>["side"]>;
}

/**
 * The behaviour and semantics behind every single-select control in the form family: a real
 * `radiogroup` whose direct children are `radio`s (sr-only native inputs inside styled labels), with
 * no intervening list markup. Native radios buy arrow-key navigation and correct screen-reader
 * announcements ("radio, selected") for free — no hand-rolled `aria-pressed`.
 *
 * Skins (`RadioGroup`, `SegmentedControl`) supply only appearance: the row/segment classes, the
 * optional selection indicator, and the tooltip side. An option with a `tooltip` wraps in a Radix
 * tooltip (no permanent height) and stays a direct child of the group because the trigger renders
 * `asChild`.
 */
export function RadioOptionGroup<T extends string>({
  label,
  ariaLabel,
  name,
  value,
  onChange,
  options,
  size,
  groupClassName,
  optionClassName,
  optionLabelClassName,
  indicator,
  tooltipSide,
}: RadioOptionGroupProps<T>) {
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
        className={groupClassName}
      >
        {options.map((option) => {
          const active = option.value === value;
          const row = (
            <label className={optionClassName(active)}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className={optionLabelClassName}>{option.label}</span>
              {indicator?.(active)}
            </label>
          );

          if (!option.tooltip) return <Fragment key={option.value}>{row}</Fragment>;

          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>{row}</TooltipTrigger>
              <TooltipContent side={tooltipSide}>{option.tooltip}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
