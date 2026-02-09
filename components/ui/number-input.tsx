import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";

const numberInputVariants = tv({
  slots: {
    label: "block font-medium mb-1",
    input:
      "w-full border bg-white/5 px-3 py-2 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500",
    hint: "mt-1 text-white/40",
    error: "mt-1 text-red-400",
  },
  variants: {
    size: {
      sm: {
        label: "text-xs text-white/50 uppercase tracking-wider",
        input:
          "rounded-lg border-white/10 text-sm placeholder-white/30",
        hint: "text-xs",
        error: "text-xs",
      },
      md: {
        label: "text-sm text-white/70 mb-1.5",
        input:
          "rounded-md border-white/10 text-sm placeholder-white/30",
        hint: "text-xs",
        error: "text-xs",
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
