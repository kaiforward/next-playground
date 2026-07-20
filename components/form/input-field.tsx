import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { formSlots, formSizeVariants } from "./form-slots";

const inputFieldVariants = tv({
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
        input: "border-border text-sm placeholder-text-tertiary",
        hint: formSizeVariants.sm.hint,
        error: formSizeVariants.sm.error,
      },
      md: {
        label: formSizeVariants.md.label,
        input: "border-border text-sm placeholder-text-tertiary",
        hint: formSizeVariants.md.hint,
        error: formSizeVariants.md.error,
      },
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

type InputFieldVariants = VariantProps<typeof inputFieldVariants>;

export interface InputFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    InputFieldVariants {
  label?: string;
  error?: string;
  hint?: string;
}

/** Shared visual scaffold for the typed text and number field exports. */
export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  function InputField(
    { label, error, hint, size, className, id, ...props },
    ref,
  ) {
    const styles = inputFieldVariants({ size });

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
        {error ? (
          <p className={styles.error()}>{error}</p>
        ) : hint ? (
          <p className={styles.hint()}>{hint}</p>
        ) : null}
      </div>
    );
  },
);
