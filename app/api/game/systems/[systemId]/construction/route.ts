import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemConstruction } from "@/lib/services/construction";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemConstructionResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/construction",
    async () => {
      const { systemId } = await params;
      const data = getSystemConstruction(systemId);
      return NextResponse.json<SystemConstructionResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
