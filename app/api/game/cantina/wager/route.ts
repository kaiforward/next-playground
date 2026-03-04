import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { settleWager } from "@/lib/services/cantina";
import type { ApiResponse } from "@/lib/types/api";
import type { WagerResult, WagerOutcome } from "@/lib/types/cantina";

interface WagerRequest {
  wager: number;
  outcome: WagerOutcome;
}

const VALID_OUTCOMES = new Set<WagerOutcome>(["win", "loss", "tie"]);

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/cantina/wager", async () => {
    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const body = await parseJsonBody<WagerRequest>(request);
    if (
      !body ||
      typeof body.wager !== "number" ||
      !Number.isFinite(body.wager) ||
      body.wager <= 0 ||
      !VALID_OUTCOMES.has(body.outcome)
    ) {
      return NextResponse.json<ApiResponse<never>>(
        { error: "Invalid wager or outcome." },
        { status: 400 },
      );
    }

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
