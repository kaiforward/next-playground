"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { formatCredits } from "@/lib/utils/format";
import { QueryBoundary } from "@/components/ui/query-boundary";

/* ------------------------------------------------------------------ */
/*  Icons (inline SVG – Heroicons Solid 20×20)                        */
/* ------------------------------------------------------------------ */

function DashboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v2.5A2.25 2.25 0 0 0 4.25 9h2.5A2.25 2.25 0 0 0 9 6.75v-2.5A2.25 2.25 0 0 0 6.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 2 13.25v2.5A2.25 2.25 0 0 0 4.25 18h2.5A2.25 2.25 0 0 0 9 15.75v-2.5A2.25 2.25 0 0 0 6.75 11h-2.5Zm9-9A2.25 2.25 0 0 0 11 4.25v2.5A2.25 2.25 0 0 0 13.25 9h2.5A2.25 2.25 0 0 0 18 6.75v-2.5A2.25 2.25 0 0 0 15.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 11 13.25v2.5A2.25 2.25 0 0 0 13.25 18h2.5A2.25 2.25 0 0 0 18 15.75v-2.5A2.25 2.25 0 0 0 15.75 11h-2.5Z" clipRule="evenodd" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path fillRule="evenodd" d="M8.157 2.176a1.5 1.5 0 0 0-1.147 0l-4.084 1.69A1.5 1.5 0 0 0 2 5.25v10.877a1.5 1.5 0 0 0 2.074 1.386l3.51-1.453 4.26 1.763a1.5 1.5 0 0 0 1.146 0l4.083-1.69A1.5 1.5 0 0 0 18 14.748V3.873a1.5 1.5 0 0 0-2.073-1.386l-3.51 1.452-4.26-1.763ZM7.58 5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 7.58 5Zm5.59 2.75a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Z" clipRule="evenodd" />
    </svg>
  );
}

function CantinaIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path d="M10 9.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V10a.75.75 0 0 0-.75-.75H10ZM6 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H6ZM8 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H8ZM9.25 14a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H10a.75.75 0 0 1-.75-.75V14ZM12 11.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V12a.75.75 0 0 0-.75-.75H12ZM12 13.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V14a.75.75 0 0 0-.75-.75H12ZM13.25 12a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H14a.75.75 0 0 1-.75-.75V12ZM11.25 10a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .75.75v.01a.75.75 0 0 1-.75.75H12a.75.75 0 0 1-.75-.75V10ZM14 9.25a.75.75 0 0 0-.75.75v.01c0 .414.336.75.75.75h.01a.75.75 0 0 0 .75-.75V10a.75.75 0 0 0-.75-.75H14Z" />
      <path fillRule="evenodd" d="M1 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6Zm2-.5h14a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z" clipRule="evenodd" />
    </svg>
  );
}

function FleetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path d="M12.556 4.605a.75.75 0 0 1-.311.953l-1.027.569a6.468 6.468 0 0 1 .307 1.873H13a.75.75 0 1 1 0 1.5h-1.475a6.478 6.478 0 0 1-.307 1.873l1.027.569a.75.75 0 1 1-.722 1.316l-1.027-.569a6.497 6.497 0 0 1-1.355 1.27l.469 1.01a.75.75 0 0 1-1.36.63l-.467-1.008a6.49 6.49 0 0 1-1.783.256v1.153a.75.75 0 0 1-1.5 0v-1.153a6.49 6.49 0 0 1-1.783-.256l-.467 1.009a.75.75 0 1 1-1.36-.63l.469-1.011a6.497 6.497 0 0 1-1.355-1.27L1.277 11.87a.75.75 0 1 1-.722-1.316l1.027-.569a6.466 6.466 0 0 1-.307-1.873H.75a.75.75 0 0 1 0-1.5h.525c.033-.656.148-1.287.307-1.873l-1.027-.569A.75.75 0 1 1 1.277 2.85l1.027.569a6.497 6.497 0 0 1 1.355-1.27L3.19 1.14a.75.75 0 0 1 1.36-.63l.467 1.009c.559-.155 1.155-.25 1.783-.256V.11a.75.75 0 0 1 1.5 0v1.153c.628.006 1.224.1 1.783.256l.467-1.008a.75.75 0 0 1 1.36.63l-.469 1.01a6.497 6.497 0 0 1 1.355 1.27l1.027-.569a.75.75 0 0 1 .953.311ZM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M14.5 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    </svg>
  );
}

function ConvoyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path d="M8 16.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
      <path fillRule="evenodd" d="M4 4a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V4Zm4-1.5v.75c0 .414.336.75.75.75h2.5a.75.75 0 0 0 .75-.75V2.5h1A1.5 1.5 0 0 1 14.5 4v12a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 16V4A1.5 1.5 0 0 1 7 2.5h1Z" clipRule="evenodd" />
    </svg>
  );
}

function EventsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path fillRule="evenodd" d="M10 2a6 6 0 0 0-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 0 0 .67 1.085h3.652a2.75 2.75 0 0 0 5.47 0h3.652a.75.75 0 0 0 .67-1.085A11.95 11.95 0 0 1 16 8a6 6 0 0 0-6-6Zm1.493 12.319a1.25 1.25 0 0 1-2.986 0h2.986Z" clipRule="evenodd" />
    </svg>
  );
}

function BattlesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path fillRule="evenodd" d="M13.5 4.938a7 7 0 1 1-9.006 1.737c.277-.23.652-.065.834.159l1.218 1.5a.75.75 0 0 0 1.078.106l.394-.329a7.014 7.014 0 0 1 2.277-1.3l.493-.147a.75.75 0 0 0 .53-.708V4.938ZM14.5 10a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
      <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Nav items                                                         */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/map", label: "Star Map", icon: MapIcon },
  { href: "/cantina", label: "Cantina", icon: CantinaIcon },
];

const FLEET_NAV: NavItem[] = [
  { href: "/fleet", label: "Fleet", icon: FleetIcon },
  { href: "/convoys", label: "Convoys", icon: ConvoyIcon },
];

const ACTIVITY_NAV: NavItem[] = [
  { href: "/events", label: "Events", icon: EventsIcon },
  { href: "/battles", label: "Battles", icon: BattlesIcon },
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
      <Icon />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <h3 className="px-3 pt-3 pb-1 text-[10px] font-display font-semibold uppercase tracking-widest text-text-muted">
      {label}
    </h3>
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
        <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden">
          {collapsed ? (
            <span className="font-display font-bold text-accent text-lg">ST</span>
          ) : (
            <span className="font-display font-bold text-accent text-sm tracking-widest uppercase whitespace-nowrap">
              Stellar Trader
            </span>
          )}
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="mt-2 flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Fleet section */}
      {!collapsed && <SectionHeader label="Fleet" />}
      <nav className="flex flex-col gap-0.5">
        {FLEET_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Activity section */}
      {!collapsed && <SectionHeader label="Activity" />}
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
        {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
      </button>

      {/* User section */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        {collapsed ? (
          <button
            onClick={() => signOut({ redirectTo: "/login" })}
            title={userEmail ?? "Sign Out"}
            className="flex items-center justify-center w-full text-text-muted hover:text-text-primary transition-colors"
          >
            <SignOutIcon />
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
