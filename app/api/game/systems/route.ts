import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UniverseResponse } from "@/lib/types/api";

/**
 * GET /api/game/systems
 * Returns all star systems and their connections (UniverseData shape).
 */
export async function GET() {
  try {
    const [systems, connections] = await Promise.all([
      prisma.starSystem.findMany({
        select: {
          id: true,
          name: true,
          economyType: true,
          x: true,
          y: true,
          description: true,
        },
      }),
      prisma.systemConnection.findMany({
        select: {
          id: true,
          fromSystemId: true,
          toSystemId: true,
          fuelCost: true,
        },
      }),
    ]);

    return NextResponse.json<UniverseResponse>({
      data: {
        systems: systems.map((s) => ({
          id: s.id,
          name: s.name,
          economyType: s.economyType as "agricultural" | "mining" | "industrial" | "tech" | "core",
          x: s.x,
          y: s.y,
          description: s.description,
        })),
        connections: connections.map((c) => ({
          id: c.id,
          fromSystemId: c.fromSystemId,
          toSystemId: c.toSystemId,
          fuelCost: c.fuelCost,
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/game/systems error:", error);
    return NextResponse.json<UniverseResponse>(
      { error: "Failed to fetch systems." },
      { status: 500 },
    );
  }
}
