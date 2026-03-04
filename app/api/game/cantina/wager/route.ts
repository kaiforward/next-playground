import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { settleWager } from "@/lib/services/cantina";
import type { ApiResponse } from "@/lib/types/api";
import type { WagerResult } from "@/lib/types/cantina";

interface WagerRequest {
  wager: number;
  outcome: "win" | "loss" | "tie";
}

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/cantina/wager", async () => {
    const body = await parseJsonBody<WagerRequest>(request);
    if (!body?.wager || !body?.outcome) {
      return NextResponse.json<ApiResponse<never>>(
        { error: "Missing wager or outcome." },
        { status: 400 },
      );
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await settleWager(auth.playerId, body.wager, body.outcome);

    if (!result.ok) {
      return NextResponse.json<ApiResponse<never>>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ApiResponse<WagerResult>>({ data: result });
  });
}
