import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import AuthSessionProvider from "@/components/providers/session-provider";
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

  return (
    <AuthSessionProvider>
      <GameShell userEmail={session.user?.email ?? null}>
        {children}
      </GameShell>
    </AuthSessionProvider>
  );
}
