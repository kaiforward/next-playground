import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getFactionVitals } from "@/lib/services/faction-vitals";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { FactionVitalsResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/factions/[factionId]/vitals",
    async () => {
      const { factionId } = await params;
      const data = getFactionVitals(factionId);
      return NextResponse.json<FactionVitalsResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
