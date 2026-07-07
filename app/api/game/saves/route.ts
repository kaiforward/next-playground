import { NextRequest, NextResponse } from "next/server";
import { listGameSaves, saveGame } from "@/lib/services/game";
import { saveGameSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ApiResponse, SaveGameResponse, SavesResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/saves", async () => {
    const data = await listGameSaves();
    return NextResponse.json<SavesResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ name?: string }>(request);
  const result = saveGameSchema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }

  const saved = await saveGame(result.data.name);
  if (!saved.ok) {
    // The only save failure is "no world loaded" — same conflict the store signals.
    return NextResponse.json<ApiResponse<never>>({ error: saved.error }, { status: 409 });
  }
  return NextResponse.json<SaveGameResponse>({ data: saved.data });
}
