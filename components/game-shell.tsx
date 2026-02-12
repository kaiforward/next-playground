"use client";

import GameNav from "@/components/game-nav";
import { TickProvider, useTickContext } from "@/lib/hooks/use-tick-context";
import { useTickInvalidation } from "@/lib/hooks/use-tick-invalidation";
import { EventToastContainer } from "@/components/events/event-toast-container";

interface GameShellProps {
  userEmail: string | null;
  children: React.ReactNode;
}

export function GameShell({ userEmail, children }: GameShellProps) {
  return (
    <TickProvider>
      <GameShellInner userEmail={userEmail}>{children}</GameShellInner>
    </TickProvider>
  );
}

function GameShellInner({
  userEmail,
  children,
}: GameShellProps) {
  const { currentTick } = useTickContext();
  useTickInvalidation();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <GameNav userEmail={userEmail} currentTick={currentTick} />
      <main className="flex-1">{children}</main>
      <EventToastContainer />
    </div>
  );
}
