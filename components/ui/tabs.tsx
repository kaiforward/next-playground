"use client";

import { tv, type VariantProps } from "tailwind-variants";
import { TabCountBadge } from "./tab-count-badge";
import { resolvePanelTabs, type PanelTabDef } from "./tabs-helpers";
import { useLinkComponent } from "./link-provider";

// ── TabList ─────────────────────────────────────────────────────

const tabListVariants = tv({
  base: "flex",
  variants: {
    variant: {
      underline: "border-b border-border gap-6",
      pill: "overflow-hidden border border-border",
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
  "aria-label"?: string;
}

export function TabList({ variant, className, children, "aria-label": ariaLabel }: TabListProps) {
  return (
    <nav className={tabListVariants({ variant, className })} aria-label={ariaLabel}>
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
    { variant: "underline", active: true, class: "border-accent text-text-primary" },
    { variant: "underline", active: false, class: "border-transparent text-text-tertiary hover:text-text-secondary" },
    // pill active — accent (default)
    { variant: "pill", active: true, activeColor: "accent", class: "bg-accent/20 text-text-accent" },
    { variant: "pill", active: true, activeColor: "green", class: "bg-status-green/20 text-status-green-light" },
    { variant: "pill", active: true, activeColor: "red", class: "bg-status-red/20 text-status-red-light" },
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
  const LinkComponent = useLinkComponent();
  return (
    <LinkComponent
      href={href}
      aria-current={active ? "page" : undefined}
      className={tabVariants({ variant, active, activeColor, className })}
    >
      {children}
      {count != null && count > 0 && (
        <TabCountBadge count={count} />
      )}
    </LinkComponent>
  );
}

// ── PanelTabs (route-backed tab strip for a detail panel) ───────

interface PanelTabsProps {
  /** The panel's own URL — the index tab's href, and the prefix every other tab appends to. */
  basePath: string;
  tabs: readonly PanelTabDef[];
  /** Accessible name for the strip, e.g. "System tabs". */
  label: string;
  /**
   * The current pathname, for `resolvePanelTabs` to test hrefs against. Taken as a prop rather than
   * read via a router hook: the two callers of this component are both panel roots that already
   * know their own current path from `useRoute()` (`components/panels/**`).
   */
  pathname: string;
}

/**
 * A detail panel's tab strip, where each tab is a route under the panel's own path. Owns both the
 * href a tab links to and which tab counts as current (`resolvePanelTabs`), so two panels can't
 * answer either question differently — the callers supply only their base path, tab list and current
 * pathname.
 */
export function PanelTabs({ basePath, tabs, label, pathname }: PanelTabsProps) {
  return (
    <TabList aria-label={label}>
      {resolvePanelTabs(basePath, tabs, pathname).map((tab) => (
        <TabLink key={tab.href} href={tab.href} active={tab.active}>
          {tab.label}
        </TabLink>
      ))}
    </TabList>
  );
}
