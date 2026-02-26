import { tv, type VariantProps } from "tailwind-variants";

const inlineAlertVariants = tv({
  base: "rounded-lg px-4 py-2 text-sm",
  variants: {
    variant: {
      error: "bg-red-500/10 border border-red-500/20 text-red-300",
      warning: "bg-amber-500/10 border border-amber-500/20 text-amber-300",
      info: "bg-blue-500/10 border border-blue-500/20 text-blue-300",
    },
  },
  defaultVariants: {
    variant: "error",
  },
});

type InlineAlertVariants = VariantProps<typeof inlineAlertVariants>;

interface InlineAlertProps extends InlineAlertVariants {
  children: React.ReactNode;
  className?: string;
}

export function InlineAlert({ children, variant, className }: InlineAlertProps) {
  return (
    <div className={inlineAlertVariants({ variant, className })}>
      {children}
    </div>
  );
}
