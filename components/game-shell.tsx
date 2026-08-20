"use client";

import { TopBar } from "@/components/top-bar";
import { TickProvider } from "@/lib/hooks/use-tick-context";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { DevToolsPanel } from "@/components/dev-tools/dev-tools-panel";
import { DevOverlayProvider } from "@/components/dev-tools/dev-overlay-context";
import { isDevBuild } from "@/lib/utils/dev-flag";

/* ------------------------------------------------------------------ */
/*  Shell                                                             */
/* ------------------------------------------------------------------ */

interface GameShellProps {
  panel?: React.ReactNode;
  children: React.ReactNode;
}

export function GameShell({ panel, children }: GameShellProps) {
  return (
    <TickProvider>
      <DevOverlayProvider>
        <GameShellInner panel={panel}>{children}</GameShellInner>
      </DevOverlayProvider>
    </TickProvider>
  );
}

function GameShellInner({ panel, children }: GameShellProps) {
  useTickInvalidation();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopBar />
      <main className="flex-1 relative overflow-hidden">
        {children}
        {panel}
        {/* The Tracker panel is not mounted here — it lives in `MapRightRail`
            (components/map/map-right-rail.tsx), sharing a real flex container with the map
            controls dock so the map is the only route the Tracker renders on. Routes without a
            map (there are none currently — every game route renders `StarMap`) would lose it. */}
      </main>
      {isDevBuild() && <DevToolsPanel />}
    </div>
  );
}
