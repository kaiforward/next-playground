import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemLogistics } from "@/lib/services/trade-flow";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemLogisticsResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/logistics",
    async () => {
      const { systemId } = await params;
      const data = getSystemLogistics(systemId);
      return NextResponse.json<SystemLogisticsResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
