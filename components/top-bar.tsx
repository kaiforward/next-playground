"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";

/* ------------------------------------------------------------------ */
/*  Breadcrumb data resolution                                        */
/* ------------------------------------------------------------------ */

/** Maps static route segments to display labels. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  map: "Star Map",
  cantina: "Cantina",
  fleet: "Fleet",
  convoys: "Convoys",
  events: "Events",
  battles: "Battles",
  market: "Market",
  trade: "Trade",
  shipyard: "Shipyard",
  missions: "Missions",
};

interface Crumb {
  label: string;
  href?: string;
}

/** Resolve system/ship/convoy names from hooks. */
function useBreadcrumbNames() {
  // System names
  const { data: universe } = useUniverse();
  const systemMap = new Map(universe.systems.map((s) => [s.id, s.name]));

  // Ship names
  const { fleet } = useFleet();
  const shipMap = new Map(fleet.ships.map((s) => [s.id, s.name]));

  // Convoy names
  const { convoys } = useConvoys();
  const convoyMap = new Map(convoys.map((c) => [c.id, c.name]));

  return { systemMap, shipMap, convoyMap };
}

function BreadcrumbsInner() {
  const pathname = usePathname();
  const { systemMap, shipMap, convoyMap } = useBreadcrumbNames();

  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const href = "/" + segments.slice(0, i + 1).join("/");
    const prev = segments[i - 1];

    // Dynamic segment resolution
    if (prev === "system") {
      crumbs.push({ label: systemMap.get(seg) ?? seg, href });
    } else if (prev === "ship") {
      crumbs.push({ label: shipMap.get(seg) ?? seg, href });
    } else if (prev === "convoy") {
      crumbs.push({ label: convoyMap.get(seg) ?? seg, href });
    } else if (SEGMENT_LABELS[seg]) {
      crumbs.push({ label: SEGMENT_LABELS[seg], href });
    } else {
      // Skip pure ID segments that were already handled
      if (["system", "ship", "convoy"].includes(seg)) continue;
      crumbs.push({ label: seg, href });
    }
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs min-w-0">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <span className="text-text-faint">/</span>}
            {isLast || !crumb.href ? (
              <span className="text-text-primary truncate">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="text-text-secondary hover:text-text-primary transition-colors truncate">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function BreadcrumbsFallback() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  const label = first ? SEGMENT_LABELS[first] ?? first : "";
  return (
    <nav aria-label="Breadcrumb" className="flex items-center text-xs">
      <span className="text-text-primary">{label}</span>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Top bar                                                           */
/* ------------------------------------------------------------------ */

export function TopBar() {
  return (
    <header className="h-[var(--topbar-height)] flex items-center px-4 bg-background border-b border-border shrink-0">
      <QueryBoundary loadingFallback={<BreadcrumbsFallback />}>
        <BreadcrumbsInner />
      </QueryBoundary>
    </header>
  );
}
