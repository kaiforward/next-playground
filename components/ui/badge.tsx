import { tv, type VariantProps } from "tailwind-variants";

const badgeVariants = tv({
  base: "inline-flex items-center px-2 py-0.5 text-xs font-medium",
  variants: {
    color: {
      green: "bg-status-green/20 text-status-green-light",
      amber: "bg-status-amber/20 text-status-amber-light",
      blue: "bg-status-blue/20 text-status-blue-light",
      purple: "bg-status-purple/20 text-status-purple-light",
      slate: "bg-status-slate/20 text-status-slate-light",
      red: "bg-status-red/20 text-status-red-light",
      cyan: "bg-status-cyan/20 text-status-cyan-light",
    },
  },
  defaultVariants: {
    color: "slate",
  },
});

type BadgeVariants = VariantProps<typeof badgeVariants>;

export type BadgeColor = NonNullable<BadgeVariants["color"]>;

interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">, BadgeVariants {}

export function Badge({ color, className, children, ...props }: BadgeProps) {
  return (
    <span className={badgeVariants({ color, className })} {...props}>
      {children}
    </span>
  );
}
