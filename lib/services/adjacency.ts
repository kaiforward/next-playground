import { prisma } from "@/lib/prisma";
import { buildAdjacencyList } from "@/lib/engine/visibility";

/**
 * Cached adjacency list for the system connection graph.
 * Connections are static (only change at seed time), so we build
 * the adjacency map once and reuse it across all visibility checks.
 */
let cached: Map<string, string[]> | null = null;

export async function getAdjacencyList(): Promise<Map<string, string[]>> {
  if (cached) return cached;

  const connections = await prisma.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true },
  });

  cached = buildAdjacencyList(connections);
  return cached;
}
