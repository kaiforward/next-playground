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
  return withServiceErrors("POST /api/game/saves", async () => {
    const body = await parseJsonBody<{ name?: string }>(request);
    const result = saveGameSchema.safeParse(body);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(", ");
      return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
    }

    // saveGame returns ok:false only for the expected "no world loaded" conflict;
    // an fs write failure throws and is turned into a graceful 500 by the wrapper.
    const saved = await saveGame(result.data.name);
    if (!saved.ok) {
      return NextResponse.json<ApiResponse<never>>({ error: saved.error }, { status: 409 });
    }
    return NextResponse.json<SaveGameResponse>({ data: saved.data });
  });
}
