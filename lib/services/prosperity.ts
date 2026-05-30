import { prisma } from "@/lib/prisma";
import type { ProsperityEntry } from "@/lib/types/game";

/** All systems' current prosperity (-1..+1). Tick-scoped; refetched on a short staleTime. */
export async function getProsperityBySystem(): Promise<ProsperityEntry[]> {
  const rows = await prisma.starSystem.findMany({
    select: { id: true, prosperity: true },
  });
  return rows.map((r) => ({ systemId: r.id, prosperity: r.prosperity }));
}
