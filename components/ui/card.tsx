"use client";

import { tv, type VariantProps } from "tailwind-variants";

const cardVariants = tv({
  base: "bg-surface border-l-2 border-l-accent",
  variants: {
    variant: {
      default: "",
      bordered: "border border-border",
    },
    padding: {
      sm: "p-3",
      md: "p-5",
      lg: "p-7",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "md",
  },
});

type CardVariants = VariantProps<typeof cardVariants>;

interface CardProps extends React.HTMLAttributes<HTMLDivElement>, CardVariants {}

export function Card({
  variant,
  padding,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div className={cardVariants({ variant, padding, className })} {...props}>
      {children}
    </div>
  );
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
  ...props
}: CardHeaderProps) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 ${className ?? ""}`} {...props}>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold font-display text-text-primary">{title}</h3>
        {subtitle && (
          <p className="mt-1 text-sm text-text-tertiary">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}
