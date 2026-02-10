import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { executeNavigation } from "@/lib/services/navigation";
import type { ShipNavigateRequest, ShipNavigateResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;

    let body: ShipNavigateRequest;
    try {
      body = (await request.json()) as ShipNavigateRequest;
    } catch {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const result = await executeNavigation(playerId, shipId, body.route);

    if (!result.ok) {
      return NextResponse.json<ShipNavigateResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipNavigateResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/navigate error:", error);
    return NextResponse.json<ShipNavigateResponse>(
      { error: "Failed to navigate." },
      { status: 500 },
    );
  }
}
