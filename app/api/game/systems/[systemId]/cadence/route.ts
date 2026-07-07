import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemCadence } from "@/lib/services/system-cadence";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemCadenceResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/systems/[systemId]/cadence", async () => {
    const { systemId } = await params;
    const data = getSystemCadence(systemId);
    return NextResponse.json<SystemCadenceResponse>({ data });
  });
}
