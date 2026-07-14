"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radio, Landmark, Network, Save, DoorOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/components/ui/dialog";
import { SaveGameDialog } from "@/components/save-game-dialog";
import { SpeedControls } from "@/components/speed-controls";
import { useTickContext } from "@/lib/hooks/use-tick-context";

/* ------------------------------------------------------------------ */
/*  Primary nav                                                       */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const TOP_NAV: NavItem[] = [
  { href: "/events", label: "Events", icon: Radio },
  { href: "/factions", label: "Factions", icon: Landmark },
  { href: "/diplomacy", label: "Diplomacy", icon: Network },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-1.5 h-[var(--topbar-height)] px-3 text-sm border-b-2 transition-colors ${
        active
          ? "border-b-accent bg-surface-active text-text-primary"
          : "border-b-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Tick / TPS readout                                                */
/* ------------------------------------------------------------------ */

function TickReadout() {
  const { currentTick, achievedTps } = useTickContext();
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono text-text-secondary whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-pulse shrink-0" />
      <span>
        t.<span className="text-text-primary">{currentTick}</span>
      </span>
      <span className="text-text-tertiary">·</span>
      <span>
        <span className="text-text-primary">{achievedTps}</span> tps
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Top bar                                                           */
/* ------------------------------------------------------------------ */

export function TopBar() {
  const pathname = usePathname();
  const saveDialog = useDialog();

  // Longest-prefix match across nav hrefs so nested entries (e.g. /factions
  // + /factions/[id]) don't both highlight.
  const activeHref = TOP_NAV.map((n) => n.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .reduce((best, h) => (h.length > best.length ? h : best), "");

  return (
    <header className="h-[var(--topbar-height)] flex items-center gap-5 px-3.5 bg-background border-b border-border shrink-0">
      <h1 className="sr-only">Stellar Trader</h1>

      {/* Left: logo + primary nav */}
      <Link href="/" className="shrink-0">
        <span className="font-display font-bold text-text-accent text-sm tracking-widest uppercase whitespace-nowrap">
          Stellar Trader
        </span>
      </Link>
      <nav aria-label="Primary navigation" className="flex items-center">
        {TOP_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={item.href === activeHref} />
        ))}
      </nav>

      {/* Roomy center-left — treasury/resource readouts land here in a later workstream */}
      <div className="flex-1" />

      {/* Center: simulation speed + tick/tps */}
      <div className="flex items-center gap-4 shrink-0">
        <SpeedControls layout="horizontal" />
        <TickReadout />
      </div>

      {/* Right: save / exit */}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onClick={saveDialog.onOpen}>
          <Save className="w-4 h-4" />
          <span className="ml-1.5">Save</span>
        </Button>
        <Button variant="ghost" size="sm" href="/start">
          <DoorOpen className="w-4 h-4" />
          <span className="ml-1.5">Exit</span>
        </Button>
      </div>
      <SaveGameDialog open={saveDialog.open} onClose={saveDialog.onClose} />
    </header>
  );
}
