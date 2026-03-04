import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { recordNpcVisit } from "@/lib/services/cantina";
import type { ApiResponse } from "@/lib/types/api";
import type { NpcVisitResult } from "@/lib/types/cantina";
import type { CantinaNpcType } from "@/lib/constants/cantina-npcs";

interface VisitRequest {
  npcType: CantinaNpcType;
}

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  return withServiceErrors("POST /api/game/cantina/[systemId]/visit", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const { systemId } = await params;
    const body = await parseJsonBody<VisitRequest>(request);
    if (!body?.npcType) {
      return NextResponse.json<ApiResponse<never>>(
        { error: "Missing npcType." },
        { status: 400 },
      );
    }

    const data = await recordNpcVisit(auth.playerId, body.npcType, systemId);
    return NextResponse.json<ApiResponse<NpcVisitResult>>({ data });
  });
}
