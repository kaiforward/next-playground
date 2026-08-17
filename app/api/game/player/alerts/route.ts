import { NextRequest, NextResponse } from "next/server";
import { getAlertData } from "@/lib/services/alerts";
import { setAlertCategory } from "@/lib/services/player-settings";
import { alertCategorySchema } from "@/lib/schemas/player-settings";
import { parseJsonBody } from "@/lib/api/parse-json";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ApiResponse, AlertResponse, AlertCategoriesResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/player/alerts", async () => {
    const data = getAlertData();
    return NextResponse.json<AlertResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}

/** Turns one alert category on or off. The category settings ride the GET above rather than having
 *  a read of their own, the same split `pinnedSystemIds` uses (read on `TrackerData`, written on
 *  `POST /api/game/player/pins`). */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ categoryId?: string; on?: boolean }>(request);
  const parsed = alertCategorySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = setAlertCategory(parsed.data);
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<AlertCategoriesResponse>({ data: result.data });
}
