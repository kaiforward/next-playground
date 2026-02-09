import { tv, type VariantProps } from "tailwind-variants";

const formErrorVariants = tv({
  base: "text-sm rounded-md",
  variants: {
    variant: {
      inline:
        "bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3",
      banner:
        "bg-red-900/40 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg flex items-center justify-between",
    },
  },
  defaultVariants: {
    variant: "inline",
  },
});

type FormErrorVariants = VariantProps<typeof formErrorVariants>;

interface FormErrorProps extends FormErrorVariants {
  message?: string | null;
  onDismiss?: () => void;
}

export function FormError({ message, variant, onDismiss }: FormErrorProps) {
  if (!message) return null;

  return (
    <div className={formErrorVariants({ variant })}>
      <span>{message}</span>
      {variant === "banner" && onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-white text-xs font-medium ml-4"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
