"use client";

import Link from "next/link";
import { tv, type VariantProps } from "tailwind-variants";
import { TabCountBadge } from "./tab-count-badge";

// ── TabList ─────────────────────────────────────────────────────

const tabListVariants = tv({
  base: "flex",
  variants: {
    variant: {
      underline: "border-b border-border gap-6",
      pill: "rounded-lg overflow-hidden border border-border",
    },
  },
  defaultVariants: {
    variant: "underline",
  },
});

type TabListVariants = VariantProps<typeof tabListVariants>;

interface TabListProps extends TabListVariants {
  children: React.ReactNode;
  className?: string;
}

export function TabList({ variant, className, children }: TabListProps) {
  return (
    <nav className={tabListVariants({ variant, className })}>
      {children}
    </nav>
  );
}

// ── Tab (button trigger) ────────────────────────────────────────

const tabVariants = tv({
  base: "text-sm font-medium transition-colors",
  variants: {
    variant: {
      underline: "pb-2.5 border-b-2 -mb-px flex items-center",
      pill: "flex-1 py-2 text-center",
    },
    active: {
      true: "",
      false: "",
    },
    activeColor: {
      accent: "",
      green: "",
      red: "",
    },
  },
  compoundVariants: [
    // underline active
    { variant: "underline", active: true, class: "border-indigo-400 text-white" },
    { variant: "underline", active: false, class: "border-transparent text-text-tertiary hover:text-text-secondary" },
    // pill active — accent (default)
    { variant: "pill", active: true, activeColor: "accent", class: "bg-indigo-500/20 text-indigo-300" },
    { variant: "pill", active: true, activeColor: "green", class: "bg-green-500/20 text-green-300" },
    { variant: "pill", active: true, activeColor: "red", class: "bg-red-500/20 text-red-300" },
    { variant: "pill", active: false, class: "bg-surface text-text-tertiary hover:text-text-secondary" },
  ],
  defaultVariants: {
    variant: "underline",
    active: false,
    activeColor: "accent",
  },
});

type TabVariants = VariantProps<typeof tabVariants>;

interface TabProps extends Omit<TabVariants, "active"> {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
  className?: string;
}

export function Tab({
  variant,
  active,
  activeColor,
  onClick,
  count,
  className,
  children,
}: TabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={tabVariants({ variant, active, activeColor, className })}
    >
      {children}
      {count != null && count > 0 && (
        <TabCountBadge count={count} />
      )}
    </button>
  );
}

// ── TabLink (Next.js Link trigger) ──────────────────────────────

interface TabLinkProps extends Omit<TabVariants, "active"> {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
  className?: string;
}

export function TabLink({
  variant,
  active,
  activeColor,
  href,
  count,
  className,
  children,
}: TabLinkProps) {
  return (
    <Link
      href={href}
      className={tabVariants({ variant, active, activeColor, className })}
    >
      {children}
      {count != null && count > 0 && (
        <TabCountBadge count={count} />
      )}
    </Link>
  );
}
