"use client";

import { tv, type VariantProps } from "tailwind-variants";

const cardVariants = tv({
  base: "rounded-xl bg-white/5 backdrop-blur",
  variants: {
    variant: {
      default: "",
      bordered: "border border-white/10",
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
}

export function CardHeader({
  title,
  subtitle,
  className,
  ...props
}: CardHeaderProps) {
  return (
    <div className={`mb-4 ${className ?? ""}`} {...props}>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {subtitle && (
        <p className="mt-1 text-sm text-white/50">{subtitle}</p>
      )}
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
