import { NextRequest, NextResponse } from "next/server";
import { newGame } from "@/lib/services/game";
import { newGameSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse } from "@/lib/types/api";
import type { WorldMeta } from "@/lib/world/types";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ systemCount?: number; seed?: number }>(request);
  const result = newGameSchema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }

  return NextResponse.json<ApiResponse<WorldMeta>>({ data: newGame(result.data) });
}
