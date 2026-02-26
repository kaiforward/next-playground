import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth/auth";
import AuthSessionProvider from "@/components/providers/session-provider";
import { GameQueryProvider } from "@/components/providers/query-provider";
import { GameShell } from "@/components/game-shell";

export default async function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get("sidebar-collapsed")?.value === "1";

  return (
    <AuthSessionProvider>
      <GameQueryProvider>
        <GameShell
          userEmail={session.user?.email ?? null}
          defaultSidebarCollapsed={sidebarCollapsed}
        >
          {children}
        </GameShell>
      </GameQueryProvider>
    </AuthSessionProvider>
  );
}
