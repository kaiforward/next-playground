import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import AuthSessionProvider from "@/components/providers/session-provider";
import GameNav from "@/components/game-nav";

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
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <GameNav userEmail={session.user?.email ?? null} />
        <main className="flex-1">{children}</main>
      </div>
    </AuthSessionProvider>
  );
}
