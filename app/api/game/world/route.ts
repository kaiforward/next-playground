import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GameWorldResponse } from "@/lib/types/api";

/**
 * GET /api/game/world
 * Returns the current game world state (tick info).
 */
export async function GET() {
  try {
    const world = await prisma.gameWorld.findUnique({
      where: { id: "world" },
    });

    if (!world) {
      return NextResponse.json<GameWorldResponse>(
        { error: "Game world not initialized." },
        { status: 500 },
      );
    }

    return NextResponse.json<GameWorldResponse>({
      data: {
        currentTick: world.currentTick,
        tickRate: world.tickRate,
      },
    });
  } catch (error) {
    console.error("GET /api/game/world error:", error);
    return NextResponse.json<GameWorldResponse>(
      { error: "Failed to fetch game world." },
      { status: 500 },
    );
  }
}
