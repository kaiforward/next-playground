"use client";

import { createContext, useContext } from "react";
import { GameSidebar } from "@/components/game-sidebar";
import { TopBar } from "@/components/top-bar";
import { TickProvider, useTickContext } from "@/lib/hooks/use-tick-context";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { EventHistoryProvider } from "@/components/providers/event-history-provider";
import { EventToastContainer } from "@/components/events/event-toast-container";
import { DevToolsPanel } from "@/components/dev-tools/dev-tools-panel";
import { useSidebar, type UseSidebarReturn } from "@/lib/hooks/use-sidebar";

/* ------------------------------------------------------------------ */
/*  Sidebar context                                                   */
/* ------------------------------------------------------------------ */

const SidebarContext = createContext<UseSidebarReturn | null>(null);

export function useSidebarContext(): UseSidebarReturn {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebarContext must be used within GameShell");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Shell                                                             */
/* ------------------------------------------------------------------ */

interface GameShellProps {
  userEmail: string | null;
  defaultSidebarCollapsed?: boolean;
  panel?: React.ReactNode;
  children: React.ReactNode;
}

export function GameShell({ userEmail, defaultSidebarCollapsed, panel, children }: GameShellProps) {
  return (
    <TickProvider>
      <GameShellInner userEmail={userEmail} defaultSidebarCollapsed={defaultSidebarCollapsed} panel={panel}>
        {children}
      </GameShellInner>
    </TickProvider>
  );
}

function GameShellInner({ userEmail, defaultSidebarCollapsed, panel, children }: GameShellProps) {
  const { currentTick } = useTickContext();
  const sidebar = useSidebar(defaultSidebarCollapsed);
  useTickInvalidation();

  return (
    <SidebarContext.Provider value={sidebar}>
      <EventHistoryProvider>
        <div className="min-h-screen flex bg-background text-foreground">
          <GameSidebar
            userEmail={userEmail}
            currentTick={currentTick}
            collapsed={sidebar.collapsed}
            onToggle={sidebar.toggle}
          />

          <div
            className="flex-1 flex flex-col min-w-0 transition-[margin-left] duration-200 ease-in-out"
            style={{
              marginLeft: sidebar.collapsed
                ? "var(--sidebar-collapsed-width)"
                : "var(--sidebar-width)",
            }}
          >
            <TopBar />
            <main className="flex-1 relative overflow-hidden">
              {children}
              {panel}
            </main>
            <EventToastContainer />
            {process.env.NODE_ENV === "development" && <DevToolsPanel />}
          </div>
        </div>
      </EventHistoryProvider>
    </SidebarContext.Provider>
  );
}
