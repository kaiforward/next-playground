import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getSystemCadence } from "@/lib/services/system-cadence";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemCadenceResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/systems/[systemId]/cadence", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { systemId } = await params;
    const data = await getSystemCadence(systemId);
    return NextResponse.json<SystemCadenceResponse>({ data });
  });
}
