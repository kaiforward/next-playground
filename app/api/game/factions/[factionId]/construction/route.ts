import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getFactionConstruction } from "@/lib/services/construction";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { FactionConstructionResponse } from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/factions/[factionId]/construction",
    async () => {
      const { factionId } = await params;
      const data = getFactionConstruction(factionId);
      return NextResponse.json<FactionConstructionResponse>(
        { data },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}
