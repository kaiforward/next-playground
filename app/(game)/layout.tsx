import { redirect } from "next/navigation";
import { hasWorld } from "@/lib/world/store";
import { GameQueryProvider } from "@/components/providers/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GameShell } from "@/components/game-shell";

export default async function GameLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  // No world loaded → the start screen owns world creation and loading.
  if (!hasWorld()) {
    redirect("/start");
  }

  return (
    <GameQueryProvider>
      {/* One app-wide Radix tooltip provider (shared open/close delay) for every
          tooltip in the game UI — panels, map controls, form legends. */}
      <TooltipProvider delayDuration={150}>
        <GameShell panel={panel}>{children}</GameShell>
      </TooltipProvider>
    </GameQueryProvider>
  );
}
