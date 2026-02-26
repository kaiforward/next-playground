"use client";

import { tv, type VariantProps } from "tailwind-variants";

const badgeVariants = tv({
  base: "inline-flex items-center px-2 py-0.5 text-xs font-medium",
  variants: {
    color: {
      green: "bg-green-500/20 text-green-300",
      amber: "bg-amber-500/20 text-amber-300",
      blue: "bg-blue-500/20 text-blue-300",
      purple: "bg-purple-500/20 text-purple-300",
      slate: "bg-slate-500/20 text-slate-300",
      red: "bg-red-500/20 text-red-300",
      cyan: "bg-cyan-500/20 text-cyan-300",
    },
  },
  defaultVariants: {
    color: "slate",
  },
});

type BadgeVariants = VariantProps<typeof badgeVariants>;

interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">, BadgeVariants {}

export function Badge({ color, className, children, ...props }: BadgeProps) {
  return (
    <span className={badgeVariants({ color, className })} {...props}>
      {children}
    </span>
  );
}
