import { NextRequest, NextResponse } from "next/server";
import { setGameSpeed } from "@/lib/services/game";
import { speedSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { Speed } from "@/lib/world/tick-loop";
import type { ApiResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ speed?: Speed }>(request);
  const result = speedSchema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }

  return NextResponse.json<ApiResponse<{ speed: Speed }>>({
    data: setGameSpeed(result.data.speed),
  });
}
