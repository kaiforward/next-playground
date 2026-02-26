import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { formSlots, formSizeVariants } from "./form-slots";

const rangeInputVariants = tv({
  slots: {
    label: formSlots.label,
    input: "w-full accent-blue-500 cursor-pointer",
    hint: formSlots.hint,
    valueDisplay: "text-white tabular-nums",
  },
  variants: {
    size: {
      sm: {
        label: formSizeVariants.sm.label,
        input: "h-1.5",
        hint: formSizeVariants.sm.hint,
        valueDisplay: "text-xs",
      },
      md: {
        label: formSizeVariants.md.label,
        input: "h-2",
        hint: formSizeVariants.md.hint,
        valueDisplay: "text-sm",
      },
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

type RangeInputVariants = VariantProps<typeof rangeInputVariants>;

interface RangeInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type">,
    RangeInputVariants {
  label?: string;
  hint?: string;
  /** Displayed next to the label to show the current value. */
  valueLabel?: string;
}

export const RangeInput = forwardRef<HTMLInputElement, RangeInputProps>(
  function RangeInput(
    { label, hint, valueLabel, size, className, id, ...props },
    ref,
  ) {
    const styles = rangeInputVariants({ size });

    return (
      <div>
        {(label || valueLabel) && (
          <div className="flex items-center justify-between mb-1">
            {label && (
              <label htmlFor={id} className={styles.label()}>
                {label}
              </label>
            )}
            {valueLabel && (
              <span className={styles.valueDisplay()}>{valueLabel}</span>
            )}
          </div>
        )}
        <input
          ref={ref}
          id={id}
          type="range"
          className={styles.input({ className })}
          {...props}
        />
        {hint && <p className={styles.hint()}>{hint}</p>}
      </div>
    );
  },
);
