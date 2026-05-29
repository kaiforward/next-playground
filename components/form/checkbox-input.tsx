"use client";

import { forwardRef, useId, type LabelHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { choiceRow } from "./form-slots";

const checkboxRowVariants = tv({
  base: choiceRow.base,
  variants: {
    active: choiceRow.active,
    size: choiceRow.size,
  },
  defaultVariants: { size: "sm" },
});

type CheckboxSize = VariantProps<typeof checkboxRowVariants>["size"];

interface CheckboxInputProps
  extends Omit<LabelHTMLAttributes<HTMLLabelElement>, "onChange" | "color"> {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * Indicator colour — doubles as the channel swatch and the checked fill.
   * Defaults to the copper accent.
   */
  color?: string;
  size?: CheckboxSize;
  id?: string;
}

/**
 * Accessible checkbox styled as a control-panel row: label left, a square
 * indicator pinned right. The indicator colour (overridable) serves as both the
 * channel swatch (dimmed when off) and the checked-state fill (full colour +
 * glow when on); the square shape distinguishes it from `RadioGroup`'s round
 * dot. `forwardRef` + prop spread onto the `<label>` let it act as a radix
 * `TooltipTrigger asChild`, so hover/keyboard-focus reveals an associated legend.
 */
export const CheckboxInput = forwardRef<HTMLLabelElement, CheckboxInputProps>(
  function CheckboxInput(
    { label, checked, onChange, color, size = "sm", id, ...rest },
    ref,
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const swatch = color ?? "var(--color-accent)";

    return (
      <label
        ref={ref}
        htmlFor={inputId}
        className={checkboxRowVariants({ active: checked, size })}
        {...rest}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span className="truncate">{label}</span>
        <span
          className="ml-auto h-2.5 w-2.5 shrink-0 transition-all duration-150"
          style={{
            backgroundColor: swatch,
            opacity: checked ? 1 : 0.35,
            boxShadow: checked ? `0 0 6px ${swatch}` : "none",
          }}
          aria-hidden
        />
      </label>
    );
  },
);
