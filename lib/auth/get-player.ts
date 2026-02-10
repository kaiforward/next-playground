import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";

/**
 * Get the current player from the session, including all ships.
 * Returns null if not authenticated or player not found.
 */
export async function getSessionPlayer() {
  const session = await auth();
  if (!session?.user?.id) return null;

  return prisma.player.findUnique({
    where: { userId: session.user.id },
    include: {
      ships: {
        include: {
          cargo: { include: { good: true } },
          system: true,
          destination: true,
        },
      },
    },
  });
}

/**
 * Lightweight auth check — returns just the player ID.
 * Use when the route delegates to a service that does its own DB queries.
 */
export async function getSessionPlayerId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const player = await prisma.player.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  return player?.id ?? null;
}
