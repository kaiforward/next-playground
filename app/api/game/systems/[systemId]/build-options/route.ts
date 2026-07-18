import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemBuildOptions } from "@/lib/services/build-options";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemBuildOptionsResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/build-options",
    async () => {
      const { systemId } = await params;
      const data = getSystemBuildOptions(systemId);
      return NextResponse.json<SystemBuildOptionsResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
