import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemIndustry } from "@/lib/services/universe";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemIndustryResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/industry",
    async () => {
      const { systemId } = await params;
      const data = getSystemIndustry(systemId);
      return NextResponse.json<SystemIndustryResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
