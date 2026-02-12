import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";

const rangeInputVariants = tv({
  slots: {
    label: "block font-medium mb-1",
    input: "w-full accent-blue-500 cursor-pointer",
    hint: "mt-1 text-white/40",
    valueDisplay: "text-white tabular-nums",
  },
  variants: {
    size: {
      sm: {
        label: "text-xs text-white/50 uppercase tracking-wider",
        input: "h-1.5",
        hint: "text-xs",
        valueDisplay: "text-xs",
      },
      md: {
        label: "text-sm text-white/70 mb-1.5",
        input: "h-2",
        hint: "text-xs",
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
