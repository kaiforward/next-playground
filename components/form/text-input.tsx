import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { formSlots, formSizeVariants } from "./form-slots";

const textInputVariants = tv({
  slots: {
    label: formSlots.label,
    input:
      "w-full border bg-surface px-3 py-2 text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent",
    error: formSlots.error,
  },
  variants: {
    size: {
      sm: {
        label: formSizeVariants.sm.label,
        input:
          "border-border text-sm placeholder-text-faint",
        error: formSizeVariants.sm.error,
      },
      md: {
        label: formSizeVariants.md.label,
        input:
          "border-border text-sm placeholder-text-faint",
        error: formSizeVariants.md.error,
      },
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

type TextInputVariants = VariantProps<typeof textInputVariants>;

interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    TextInputVariants {
  label?: string;
  error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ label, error, size, className, id, ...props }, ref) {
    const styles = textInputVariants({ size });

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
          className={styles.input({ className })}
          {...props}
        />
        {error && <p className={styles.error()}>{error}</p>}
      </div>
    );
  }
);
