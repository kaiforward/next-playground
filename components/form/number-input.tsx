import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { formSlots, formSizeVariants } from "./form-slots";

const numberInputVariants = tv({
  slots: {
    label: formSlots.label,
    input:
      "w-full border bg-surface px-3 py-2 text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent",
    hint: formSlots.hint,
    error: formSlots.error,
  },
  variants: {
    size: {
      sm: {
        label: formSizeVariants.sm.label,
        input:
          "border-border text-sm placeholder-text-faint",
        hint: formSizeVariants.sm.hint,
        error: formSizeVariants.sm.error,
      },
      md: {
        label: formSizeVariants.md.label,
        input:
          "border-border text-sm placeholder-text-faint",
        hint: formSizeVariants.md.hint,
        error: formSizeVariants.md.error,
      },
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

type NumberInputVariants = VariantProps<typeof numberInputVariants>;

interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type">,
    NumberInputVariants {
  label?: string;
  error?: string;
  hint?: string;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    { label, error, hint, size, className, id, ...props },
    ref
  ) {
    const styles = numberInputVariants({ size });

    return (
      <div>
        {label && (
          <label htmlFor={id} className={styles.label()}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          type="number"
          className={styles.input({ className })}
          {...props}
        />
        {error ? (
          <p className={styles.error()}>{error}</p>
        ) : hint ? (
          <p className={styles.hint()}>{hint}</p>
        ) : null}
      </div>
    );
  }
);
