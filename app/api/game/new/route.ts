import { NextRequest, NextResponse } from "next/server";
import { newGame } from "@/lib/services/game";
import { newGameSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse, NewGameResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ systemCount?: number; seed?: number }>(request);
  const result = newGameSchema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }

  return NextResponse.json<NewGameResponse>({ data: newGame(result.data) });
}
