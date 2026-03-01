import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemDetail } from "@/lib/services/universe";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemDetailResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("GET /api/game/systems/[systemId]", async () => {
    const { systemId } = await params;
    const data = await getSystemDetail(systemId);
    return NextResponse.json<SystemDetailResponse>({ data });
  });
}
