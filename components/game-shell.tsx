"use client";

import { TopBar } from "@/components/top-bar";
import { TickProvider } from "@/lib/hooks/use-tick-context";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { DevToolsPanel } from "@/components/dev-tools/dev-tools-panel";
import { DevOverlayProvider } from "@/components/dev-tools/dev-overlay-context";

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
      </main>
      {process.env.NODE_ENV === "development" && <DevToolsPanel />}
    </div>
  );
}
