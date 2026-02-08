import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SystemDetailResponse } from "@/lib/types/api";
import type { EconomyType } from "@/lib/types/game";

/**
 * GET /api/game/systems/[systemId]
 * Returns a single star system with its station info.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  try {
    const { systemId } = await params;

    const system = await prisma.starSystem.findUnique({
      where: { id: systemId },
      include: {
        station: {
          select: { id: true, name: true },
        },
      },
    });

    if (!system) {
      return NextResponse.json<SystemDetailResponse>(
        { error: "System not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<SystemDetailResponse>({
      data: {
        id: system.id,
        name: system.name,
        economyType: system.economyType as EconomyType,
        x: system.x,
        y: system.y,
        description: system.description,
        station: system.station
          ? { id: system.station.id, name: system.station.name }
          : null,
      },
    });
  } catch (error) {
    console.error("GET /api/game/systems/[systemId] error:", error);
    return NextResponse.json<SystemDetailResponse>(
      { error: "Failed to fetch system details." },
      { status: 500 },
    );
  }
}
