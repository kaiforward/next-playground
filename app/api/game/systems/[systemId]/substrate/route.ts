import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemSubstrate } from "@/lib/services/universe";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemSubstrateResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/substrate",
    async () => {
      const { systemId } = await params;
      const data = getSystemSubstrate(systemId);
      return NextResponse.json<SystemSubstrateResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
