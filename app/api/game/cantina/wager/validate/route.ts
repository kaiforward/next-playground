import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { validateWager } from "@/lib/services/cantina";
import type { ApiResponse } from "@/lib/types/api";
import type { WagerValidation } from "@/lib/types/cantina";

interface ValidateRequest {
  wager: number;
}

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/cantina/wager/validate", async () => {
    const body = await parseJsonBody<ValidateRequest>(request);
    if (!body?.wager) {
      return NextResponse.json<ApiResponse<never>>(
        { error: "Missing wager." },
        { status: 400 },
      );
    }

    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const data = await validateWager(auth.playerId, body.wager);
    return NextResponse.json<ApiResponse<WagerValidation>>({ data });
  });
}
