import { forwardRef, type InputHTMLAttributes } from "react";
import { tv, type VariantProps } from "tailwind-variants";

const textInputVariants = tv({
  slots: {
    label: "block font-medium mb-1",
    input:
      "w-full border bg-white/5 px-3 py-2 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500",
    error: "mt-1 text-red-400",
  },
  variants: {
    size: {
      sm: {
        label: "text-xs text-white/50 uppercase tracking-wider",
        input:
          "rounded-lg border-white/10 text-sm placeholder-white/30",
        error: "text-xs",
      },
      md: {
        label: "text-sm text-white/70 mb-1.5",
        input:
          "rounded-md border-white/10 text-sm placeholder-white/30",
        error: "text-xs",
      },
    },
  },
  defaultVariants: {
    size: "md",
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
