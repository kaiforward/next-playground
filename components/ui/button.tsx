import { forwardRef, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { tv, type VariantProps } from "tailwind-variants";

const buttonVariants = tv({
  base: "inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  variants: {
    variant: {
      primary:
        "bg-accent hover:bg-accent-muted text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background",
      action:
        "text-text-primary",
      ghost:
        "text-text-secondary hover:text-text-primary hover:bg-surface-hover",
      pill:
        "text-xs",
      dismiss:
        "text-red-400 hover:text-text-primary text-xs font-medium",
    },
    color: {
      blue: "",
      green: "",
      red: "",
      indigo: "",
      cyan: "",
    },
    size: {
      xs: "py-1 px-2.5 text-xs",
      sm: "py-1.5 px-3 text-xs",
      md: "py-2 px-4 text-sm",
      lg: "py-2.5 px-4 text-sm",
    },
    fullWidth: {
      true: "w-full",
    },
  },
  compoundVariants: [
    // Action button colors
    { variant: "action", color: "green", className: "bg-green-600 hover:bg-green-500" },
    { variant: "action", color: "red", className: "bg-red-600 hover:bg-red-500" },
    { variant: "action", color: "indigo", className: "bg-accent hover:bg-accent-muted" },
    // Pill button colors
    { variant: "pill", color: "cyan", className: "bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30" },
    { variant: "pill", color: "indigo", className: "bg-accent/20 text-accent hover:bg-accent/30" },
    // Ghost size uses semibold for lg
    { variant: "action", size: "md", className: "font-semibold" },
    { variant: "action", size: "lg", className: "font-semibold" },
  ],
  defaultVariants: {
    variant: "primary",
    size: "lg",
  },
});

type ButtonVariants = VariantProps<typeof buttonVariants>;

interface ButtonBaseProps extends ButtonVariants {
  className?: string;
  children: React.ReactNode;
}

interface ButtonAsButton
  extends ButtonBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> {
  href?: never;
}

interface ButtonAsLink extends ButtonBaseProps {
  href: string;
}

type ButtonProps = ButtonAsButton | ButtonAsLink;

/**
 * Button component — renders `<button>` or Next.js `<Link>` depending on `href`.
 *
 * Note: `forwardRef` does not support discriminated union element types, so
 * link-mode Buttons do not forward `ref`. In practice no callers use refs on
 * link-mode Buttons; if needed, use `<Link>` directly.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant, color, size, fullWidth, className, children, ...props },
    ref
  ) {
    const classes = buttonVariants({ variant, color, size, fullWidth, className });

    if ("href" in props && props.href) {
      const { href, ...rest } = props;
      return (
        <Link
          href={href}
          className={classes}
          {...rest}
        >
          {children}
        </Link>
      );
    }

    return (
      <button
        ref={ref}
        className={classes}
        {...props}
      >
        {children}
      </button>
    );
  }
);

export { buttonVariants };
