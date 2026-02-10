import { NextResponse } from "next/server";
import { getUniverse } from "@/lib/services/universe";
import type { UniverseResponse } from "@/lib/types/api";

export async function GET() {
  try {
    const data = await getUniverse();
    return NextResponse.json<UniverseResponse>({ data });
  } catch (error) {
    console.error("GET /api/game/systems error:", error);
    return NextResponse.json<UniverseResponse>(
      { error: "Failed to fetch systems." },
      { status: 500 },
    );
  }
}
