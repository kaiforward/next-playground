import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import AuthSessionProvider from "@/components/providers/session-provider";
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
  const session = await auth();
  const playerId = await getSessionPlayerId();

  // A re-seed wipes players but leaves the JWT cookie intact: `session` is still
  // truthy, yet its player no longer exists. Gate on player existence so the
  // stale session redirects to login instead of stranding a broken game screen.
  if (!session || !playerId) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("sidebar-collapsed")?.value;
  const sidebarCollapsed = sidebarCookie === undefined ? true : sidebarCookie === "1";

  return (
    <AuthSessionProvider>
      <GameQueryProvider>
        {/* One app-wide Radix tooltip provider (shared open/close delay) for every
            tooltip in the game UI — panels, map controls, form legends. */}
        <TooltipProvider delayDuration={150}>
          <GameShell
            userEmail={session.user?.email ?? null}
            defaultSidebarCollapsed={sidebarCollapsed}
            panel={panel}
          >
            {children}
          </GameShell>
        </TooltipProvider>
      </GameQueryProvider>
    </AuthSessionProvider>
  );
}
