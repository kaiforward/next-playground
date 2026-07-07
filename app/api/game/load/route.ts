import { NextRequest, NextResponse } from "next/server";
import { loadGame } from "@/lib/services/game";
import { loadGameSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse, LoadGameResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ name?: string }>(request);
  const result = loadGameSchema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }

  const loaded = await loadGame(result.data.name);
  if (!loaded.ok) {
    return NextResponse.json<ApiResponse<never>>({ error: loaded.error }, { status: 400 });
  }
  return NextResponse.json<LoadGameResponse>({ data: loaded.data });
}
