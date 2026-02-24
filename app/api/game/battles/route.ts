import { NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { getActiveBattles } from "@/lib/services/missions-v2";
import type { BattlesResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<BattlesResponse>(
        { error: "Player not found." },
        { status: 404 },
      );
    }

    const battles = await getActiveBattles(playerId);
    return NextResponse.json<BattlesResponse>({ data: battles });
  } catch (error) {
    console.error("GET /api/game/battles error:", error);
    return NextResponse.json<BattlesResponse>(
      { error: "Failed to fetch battles." },
      { status: 500 },
    );
  }
}
