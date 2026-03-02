import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getViewportSystems } from "@/lib/services/atlas";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { ViewportSystemsResponse } from "@/lib/types/api";

const REQUIRED_PARAMS = ["minX", "minY", "maxX", "maxY"] as const;

export function GET(request: NextRequest) {
  return withServiceErrors("GET /api/game/systems/viewport", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { searchParams } = request.nextUrl;

    // Check all params exist before Number() conversion — Number(null) is 0, not NaN
    if (REQUIRED_PARAMS.some((p) => !searchParams.has(p))) {
      return NextResponse.json<ViewportSystemsResponse>(
        { error: "Missing or invalid bounds: minX, minY, maxX, maxY required." },
        { status: 400 },
      );
    }

    const minX = Number(searchParams.get("minX"));
    const minY = Number(searchParams.get("minY"));
    const maxX = Number(searchParams.get("maxX"));
    const maxY = Number(searchParams.get("maxY"));

    if ([minX, minY, maxX, maxY].some(Number.isNaN)) {
      return NextResponse.json<ViewportSystemsResponse>(
        { error: "Missing or invalid bounds: minX, minY, maxX, maxY required." },
        { status: 400 },
      );
    }

    const data = await getViewportSystems({ minX, minY, maxX, maxY });
    return NextResponse.json<ViewportSystemsResponse>({ data });
  });
}
