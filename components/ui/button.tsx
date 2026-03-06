import { forwardRef, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { tv, type VariantProps } from "tailwind-variants";

const buttonVariants = tv({
  base: "inline-flex items-center justify-center font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  variants: {
    variant: {
      primary:
        "bg-accent hover:bg-accent-muted text-background font-semibold border border-accent/50 hover:border-accent",
      action:
        "text-text-primary border",
      ghost:
        "text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-transparent hover:border-border",
      pill:
        "text-xs border",
      outline:
        "bg-transparent text-text-accent border border-accent/40 hover:bg-accent/10 hover:border-accent/70",
      dismiss:
        "text-status-red-light hover:text-status-red-light hover:bg-status-red/10 text-xs font-medium border border-transparent hover:border-status-red/20",
    },
    color: {
      blue: "",
      green: "",
      red: "",
      accent: "",
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
    // Action button colors — tinted backgrounds with matching borders (instrument panel style)
    { variant: "action", color: "green", className: "bg-status-green/15 text-status-green-light border-status-green/30 hover:bg-status-green/25 hover:border-status-green/50" },
    { variant: "action", color: "red", className: "bg-status-red/15 text-status-red-light border-status-red/30 hover:bg-status-red/25 hover:border-status-red/50" },
    { variant: "action", color: "accent", className: "bg-accent/10 text-text-accent border-accent/30 hover:bg-accent/20 hover:border-accent/50" },
    // Pill button colors
    { variant: "pill", color: "cyan", className: "bg-status-cyan/15 text-status-cyan-light border-status-cyan/25 hover:bg-status-cyan/25 hover:border-status-cyan/40" },
    { variant: "pill", color: "accent", className: "bg-accent/10 text-text-accent border-accent/25 hover:bg-accent/20 hover:border-accent/40" },
    { variant: "pill", color: "green", className: "bg-status-green/15 text-status-green-light border-status-green/25 hover:bg-status-green/25 hover:border-status-green/40" },
    // Action semibold at larger sizes
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
