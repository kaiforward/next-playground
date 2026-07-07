"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionHeader } from "@/components/ui/section-header";
import { useDialog } from "@/components/ui/dialog";
import { SaveGameDialog } from "@/components/save-game-dialog";
import { SpeedControls } from "@/components/speed-controls";
import {
  Ship,
  Radio,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Network,
  Save,
  DoorOpen,
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
];

const ACTIVITY_NAV: NavItem[] = [
  { href: "/events", label: "Events", icon: Radio },
];

const POLITICS_NAV: NavItem[] = [
  { href: "/factions", label: "Factions", icon: Landmark },
  { href: "/diplomacy", label: "Diplomacy", icon: Network },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function sidebarItemClasses(collapsed: boolean, active: boolean): string {
  return `flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
    collapsed ? "justify-center" : ""
  } ${
    active
      ? "bg-surface-active border-l-2 border-l-accent text-text-primary"
      : "border-l-2 border-l-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
  }`;
}

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
      className={sidebarItemClasses(collapsed, active)}
    >
      <Icon className="w-4.5 h-4.5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function Divider() {
  return <div className="mx-3 my-1 border-t border-border" />;
}

/* ------------------------------------------------------------------ */
/*  Main sidebar                                                      */
/* ------------------------------------------------------------------ */

interface GameSidebarProps {
  currentTick: number;
  collapsed: boolean;
  onToggle: () => void;
}

export function GameSidebar({
  currentTick,
  collapsed,
  onToggle,
}: GameSidebarProps) {
  const pathname = usePathname();
  const saveDialog = useDialog();

  // Longest-prefix match across all nav hrefs so nested entries
  // (e.g. /factions + /factions/[id]) don't both highlight.
  const allHrefs = [...FLEET_NAV, ...ACTIVITY_NAV, ...POLITICS_NAV].map((n) => n.href);
  const activeHref = allHrefs
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .reduce((best, h) => (h.length > best.length ? h : best), "");
  const isActive = (href: string) => href === activeHref;

  return (
    <aside
      className="fixed left-0 top-0 h-screen bg-surface border-r border-border z-40 flex flex-col transition-[width] duration-200 ease-in-out"
      style={{ width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)" }}
    >
      {/* Logo */}
      <div className="h-[var(--topbar-height)] flex items-center px-3 border-b border-border shrink-0">
        <Link href="/" className="flex items-center gap-2 overflow-hidden">
          {collapsed ? (
            <span className="font-display font-bold text-text-accent text-lg">ST</span>
          ) : (
            <span className="font-display font-bold text-text-accent text-sm tracking-widest uppercase whitespace-nowrap">
              Stellar Trader
            </span>
          )}
        </Link>
      </div>

      {/* Fleet section */}
      {!collapsed && <SectionHeader className="px-3 pt-3 pb-1 text-[10px]">Fleet</SectionHeader>}
      <nav aria-label="Fleet navigation" className="flex flex-col gap-0.5">
        {FLEET_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Activity section */}
      {!collapsed && <SectionHeader className="px-3 pt-3 pb-1 text-[10px]">Activity</SectionHeader>}
      <nav aria-label="Activity navigation" className="flex flex-col gap-0.5">
        {ACTIVITY_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Politics section */}
      {!collapsed && <SectionHeader className="px-3 pt-3 pb-1 text-[10px]">Politics</SectionHeader>}
      <nav aria-label="Politics navigation" className="flex flex-col gap-0.5">
        {POLITICS_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
        ))}
      </nav>

      <Divider />

      {/* Status section */}
      {!collapsed && (
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">Tick</span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="font-mono text-text-primary">{currentTick}</span>
            </div>
          </div>
          <SpeedControls />
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Game section — save / exit to menu */}
      <div className="flex flex-col gap-0.5 border-t border-border py-1">
        <button
          onClick={saveDialog.onOpen}
          title={collapsed ? "Save Game" : undefined}
          className={sidebarItemClasses(collapsed, false)}
        >
          <Save className="w-4.5 h-4.5 shrink-0" />
          {!collapsed && <span>Save Game</span>}
        </button>
        <Link
          href="/start"
          title={collapsed ? "Exit to Menu" : undefined}
          className={sidebarItemClasses(collapsed, false)}
        >
          <DoorOpen className="w-4.5 h-4.5 shrink-0" />
          {!collapsed && <span>Exit to Menu</span>}
        </Link>
      </div>
      <SaveGameDialog open={saveDialog.open} onClose={saveDialog.onClose} />

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-9 border-t border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}
