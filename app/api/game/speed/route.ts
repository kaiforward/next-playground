import { NextRequest, NextResponse } from "next/server";
import { tickLoop, type Speed } from "@/lib/world/tick-loop";
import { speedSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ speed?: Speed }>(request);
  const result = speedSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json<ApiResponse<never>>(
      { error: 'Speed must be one of "paused", 1, 5, "max".' },
      { status: 400 },
    );
  }

  tickLoop.setSpeed(result.data.speed);
  return NextResponse.json<ApiResponse<{ speed: Speed }>>({
    data: { speed: tickLoop.getSpeed() },
  });
}
