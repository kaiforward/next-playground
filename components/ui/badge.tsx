import { tv, type VariantProps } from "tailwind-variants";

const badgeVariants = tv({
  base: "inline-flex items-center px-2 py-0.5 text-xs font-medium",
  variants: {
    color: {
      green: "",
      amber: "",
      blue: "",
      purple: "",
      slate: "",
      red: "",
      cyan: "",
    },
    /**
     * `solid` (default): tinted fill, no border — the standard tag look.
     * `outline`: transparent fill, coloured border — use when a `solid` badge
     *   of the same colour sits next to it and the two need to read as
     *   distinct (e.g. a tier badge vs. a formal-state badge).
     */
    variant: {
      solid: "",
      // 2px border + dashed pattern gives a strong visual contrast against a
      // solid same-coloured badge sitting next to it.
      outline: "border-2 bg-transparent",
    },
  },
  compoundVariants: [
    { color: "green",  variant: "solid",   class: "bg-status-green/20 text-status-green-light" },
    { color: "amber",  variant: "solid",   class: "bg-status-amber/20 text-status-amber-light" },
    { color: "blue",   variant: "solid",   class: "bg-status-blue/20 text-status-blue-light" },
    { color: "purple", variant: "solid",   class: "bg-status-purple/20 text-status-purple-light" },
    { color: "slate",  variant: "solid",   class: "bg-status-slate/20 text-status-slate-light" },
    { color: "red",    variant: "solid",   class: "bg-status-red/20 text-status-red-light" },
    { color: "cyan",   variant: "solid",   class: "bg-status-cyan/20 text-status-cyan-light" },
    { color: "green",  variant: "outline", class: "border-status-green/20 text-status-green-light" },
    { color: "amber",  variant: "outline", class: "border-status-amber/20 text-status-amber-light" },
    { color: "blue",   variant: "outline", class: "border-status-blue/20 text-status-blue-light" },
    { color: "purple", variant: "outline", class: "border-status-purple/20 text-status-purple-light" },
    { color: "slate",  variant: "outline", class: "border-status-slate/20 text-status-slate-light" },
    { color: "red",    variant: "outline", class: "border-status-red/20 text-status-red-light" },
    { color: "cyan",   variant: "outline", class: "border-status-cyan/20 text-status-cyan-light" },
  ],
  defaultVariants: {
    color: "slate",
    variant: "solid",
  },
});

type BadgeVariants = VariantProps<typeof badgeVariants>;

export type BadgeColor = NonNullable<BadgeVariants["color"]>;

interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">, BadgeVariants {}

export function Badge({ color, variant, className, children, ...props }: BadgeProps) {
  return (
    <span className={badgeVariants({ color, variant, className })} {...props}>
      {children}
    </span>
  );
}
