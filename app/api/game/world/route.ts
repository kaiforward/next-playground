import { NextResponse } from "next/server";
import { getGameWorld } from "@/lib/services/world";
import { ServiceError } from "@/lib/services/errors";
import type { GameWorldResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const data = await getGameWorld();
    return NextResponse.json<GameWorldResponse>({ data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<GameWorldResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/world error:", error);
    return NextResponse.json<GameWorldResponse>(
      { error: "Failed to fetch game world." },
      { status: 500 },
    );
  }
}
