import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth/auth";
import AuthSessionProvider from "@/components/providers/session-provider";
import { GameQueryProvider } from "@/components/providers/query-provider";
import { GameShell } from "@/components/game-shell";

export default async function GameLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("sidebar-collapsed")?.value;
  const sidebarCollapsed = sidebarCookie === undefined ? true : sidebarCookie === "1";

  return (
    <AuthSessionProvider>
      <GameQueryProvider>
        <GameShell
          userEmail={session.user?.email ?? null}
          defaultSidebarCollapsed={sidebarCollapsed}
          panel={panel}
        >
          {children}
        </GameShell>
      </GameQueryProvider>
    </AuthSessionProvider>
  );
}
