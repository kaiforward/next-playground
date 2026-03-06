import { tv, type VariantProps } from "tailwind-variants";

const inlineAlertVariants = tv({
  base: "px-4 py-2 text-sm",
  variants: {
    variant: {
      error: "bg-status-red/10 border border-status-red/20 text-status-red-light",
      warning: "bg-status-amber/10 border border-status-amber/20 text-status-amber-light",
      info: "bg-status-blue/10 border border-status-blue/20 text-status-blue-light",
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
