"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { formatCredits } from "@/lib/utils/format";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  Ship,
  ShipWheel,
  Radio,
  Crosshair,
  ChevronLeft,
  ChevronRight,
  LogOut,
  NotebookText,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Nav items                                                         */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const FLEET_NAV: NavItem[] = [
  { href: "/fleet", label: "Fleet", icon: Ship },
  { href: "/convoys", label: "Convoys", icon: ShipWheel },
];

const ACTIVITY_NAV: NavItem[] = [
  { href: "/log", label: "Captain's Log", icon: NotebookText },
  { href: "/missions", label: "Missions", icon: ListChecks },
  { href: "/events", label: "Events", icon: Radio },
  { href: "/battles", label: "Battles", icon: Crosshair },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "bg-surface-active border-l-2 border-l-accent text-text-primary"
          : "border-l-2 border-l-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      }`}
    >
      <Icon className="w-4.5 h-4.5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function Divider() {
  return <div className="mx-3 my-1 border-t border-border" />;
}

function StatusCredits() {
  const { fleet } = useFleet();
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">Credits</span>
      <span className="font-mono text-secondary">{formatCredits(fleet.credits)}</span>
    </div>
  );
}

function StatusShipCount() {
  const { fleet } = useFleet();
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">Ships</span>
      <span className="font-mono text-text-primary">{fleet.ships.length}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main sidebar                                                      */
/* ------------------------------------------------------------------ */

interface GameSidebarProps {
  userEmail: string | null;
  currentTick: number;
  collapsed: boolean;
  onToggle: () => void;
}

export function GameSidebar({
  userEmail,
  currentTick,
  collapsed,
  onToggle,
}: GameSidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      className="fixed left-0 top-0 h-screen bg-surface border-r border-border z-40 flex flex-col transition-[width] duration-200 ease-in-out"
      style={{ width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
    >
      {/* Logo */}
      <div className="h-[var(--topbar-height)] flex items-center px-3 border-b border-border shrink-0">
        <Link href="/" className="flex items-center gap-2 overflow-hidden">
          {collapsed ? (
            <span className="font-display font-bold text-accent text-lg">ST</span>
          ) : (
            <span className="font-display font-bold text-accent text-sm tracking-widest uppercase whitespace-nowrap">
              Stellar Trader
            </span>
          )}
        </Link>
      </div>

      {/* Notification bell */}
      <div className="mt-1">
        <NotificationBell collapsed={collapsed} />
      </div>

      <Divider />

      {/* Fleet section */}
      {!collapsed && <SectionHeader className="px-3 pt-3 pb-1 text-[10px]">Fleet</SectionHeader>}
      <nav className="flex flex-col gap-0.5">
        {FLEET_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Activity section */}
      {!collapsed && <SectionHeader className="px-3 pt-3 pb-1 text-[10px]">Activity</SectionHeader>}
      <nav className="flex flex-col gap-0.5">
        {ACTIVITY_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Status section */}
      {!collapsed && (
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <QueryBoundary
            loadingFallback={
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Credits</span>
                <span className="font-mono text-text-faint">---</span>
              </div>
            }
          >
            <StatusCredits />
            <StatusShipCount />
          </QueryBoundary>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Tick</span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="font-mono text-text-primary">{currentTick}</span>
            </div>
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-9 border-t border-border text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* User section */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        {collapsed ? (
          <button
            onClick={() => signOut({ redirectTo: "/login" })}
            title={userEmail ?? "Sign Out"}
            className="flex items-center justify-center w-full text-text-muted hover:text-text-primary transition-colors"
          >
            <LogOut className="w-4.5 h-4.5 shrink-0" />
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted truncate max-w-[140px]">
              {userEmail}
            </span>
            <button
              onClick={() => signOut({ redirectTo: "/login" })}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
