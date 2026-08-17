import { NextRequest, NextResponse } from "next/server";
import { getTrackerData } from "@/lib/services/tracker";
import { setTrackerSection } from "@/lib/services/player-settings";
import { trackerSectionSchema } from "@/lib/schemas/player-settings";
import { parseJsonBody } from "@/lib/api/parse-json";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ApiResponse, TrackerResponse, TrackerSectionsResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/player/tracker", async () => {
    const data = getTrackerData();
    return NextResponse.json<TrackerResponse>(
      { data },
      { headers: { "Cache-Control": "private, no-cache" } },
    );
  });
}

/** Shows or hides one Tracker section. The section settings ride the GET above rather than having a
 *  read of their own — same split as the alert bar's own categories. */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ section?: string; on?: boolean }>(request);
  const parsed = trackerSectionSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = setTrackerSection(parsed.data);
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<TrackerSectionsResponse>({ data: result.data });
}
