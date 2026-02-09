import { forwardRef, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { tv, type VariantProps } from "tailwind-variants";

const buttonVariants = tv({
  base: "inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  variants: {
    variant: {
      primary:
        "bg-blue-600 hover:bg-blue-500 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black",
      action:
        "text-white",
      ghost:
        "text-gray-400 hover:text-white hover:bg-white/5",
      pill:
        "text-xs",
      dismiss:
        "text-red-400 hover:text-white text-xs font-medium",
    },
    color: {
      blue: "",
      green: "",
      red: "",
      indigo: "",
      cyan: "",
    },
    size: {
      xs: "py-1 px-2.5 rounded-md text-xs",
      sm: "py-1.5 px-3 rounded-md text-xs",
      md: "py-2 px-4 rounded-lg text-sm",
      lg: "py-2.5 px-4 rounded-lg text-sm",
    },
    fullWidth: {
      true: "w-full",
    },
  },
  compoundVariants: [
    // Action button colors
    { variant: "action", color: "green", className: "bg-green-600 hover:bg-green-500" },
    { variant: "action", color: "red", className: "bg-red-600 hover:bg-red-500" },
    { variant: "action", color: "indigo", className: "bg-indigo-600 hover:bg-indigo-500" },
    // Pill button colors
    { variant: "pill", color: "cyan", className: "bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30" },
    { variant: "pill", color: "indigo", className: "bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30" },
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

export const Button = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(function Button(
  { variant, color, size, fullWidth, className, children, ...props },
  ref
) {
  const classes = buttonVariants({ variant, color, size, fullWidth, className });

  if ("href" in props && props.href) {
    const { href, ...rest } = props;
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={classes}
        {...rest}
      >
        {children}
      </Link>
    );
  }

  const { ...buttonProps } = props as ButtonAsButton;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      className={classes}
      {...buttonProps}
    >
      {children}
    </button>
  );
});

export { buttonVariants };
