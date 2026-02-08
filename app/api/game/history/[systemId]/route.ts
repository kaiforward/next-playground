import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TradeHistoryResponse } from "@/lib/types/api";
import type { TradeType } from "@/lib/types/game";

/**
 * GET /api/game/history/[systemId]
 * Returns the most recent 50 trade history entries for the station in the given system.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  try {
    const { systemId } = await params;

    // Find the station for this system
    const station = await prisma.station.findUnique({
      where: { systemId },
    });

    if (!station) {
      return NextResponse.json<TradeHistoryResponse>(
        { error: "No station found in this system." },
        { status: 404 },
      );
    }

    // Get the last 50 trade history entries
    const history = await prisma.tradeHistory.findMany({
      where: { stationId: station.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        good: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json<TradeHistoryResponse>({
      data: history.map((h) => ({
        id: h.id,
        stationId: h.stationId,
        goodId: h.goodId,
        goodName: h.good.name,
        price: h.price,
        quantity: h.quantity,
        type: h.type as TradeType,
        createdAt: h.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("GET /api/game/history/[systemId] error:", error);
    return NextResponse.json<TradeHistoryResponse>(
      { error: "Failed to fetch trade history." },
      { status: 500 },
    );
  }
}
