import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculatePrice } from "@/lib/engine/pricing";
import type { MarketResponse } from "@/lib/types/api";
import type { MarketEntry } from "@/lib/types/game";

/**
 * GET /api/game/market/[systemId]
 * Returns market data for the station in the given system, with computed current prices.
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
      return NextResponse.json<MarketResponse>(
        { error: "No station found in this system." },
        { status: 404 },
      );
    }

    // Get all market entries with good info
    const marketEntries = await prisma.stationMarket.findMany({
      where: { stationId: station.id },
      include: {
        good: {
          select: { id: true, name: true, basePrice: true },
        },
      },
    });

    const entries: MarketEntry[] = marketEntries.map((m) => ({
      goodId: m.good.id,
      goodName: m.good.name,
      basePrice: m.good.basePrice,
      currentPrice: calculatePrice(m.good.basePrice, m.supply, m.demand),
      supply: m.supply,
      demand: m.demand,
    }));

    return NextResponse.json<MarketResponse>({
      data: {
        stationId: station.id,
        entries,
      },
    });
  } catch (error) {
    console.error("GET /api/game/market/[systemId] error:", error);
    return NextResponse.json<MarketResponse>(
      { error: "Failed to fetch market data." },
      { status: 500 },
    );
  }
}
