import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { disbandConvoy } from "@/lib/services/convoy";
import type { ApiResponse } from "@/lib/types/api";

export function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ convoyId: string }> },
) {
  return withServiceErrors("DELETE /api/game/convoy/[convoyId]", async () => {
    const { convoyId } = await params;

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await disbandConvoy(auth.playerId, convoyId);
    if (!result.ok) {
      return NextResponse.json<ApiResponse<null>>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<ApiResponse<{ convoyId: string }>>({ data: { convoyId } });
  });
}
