import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { SystemVitalsResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/systems/[systemId]/vitals",
    async () => {
      const { systemId } = await params;
      const data = getSystemVitals(systemId);
      return NextResponse.json<SystemVitalsResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
