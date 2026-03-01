import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { installUpgrade, removeUpgrade } from "@/lib/services/upgrades";
import type { InstallUpgradeRequest, InstallUpgradeResponse, RemoveUpgradeRequest, RemoveUpgradeResponse } from "@/lib/types/api";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  return withServiceErrors("POST /api/game/ship/[shipId]/upgrades", async () => {
    const { shipId } = await params;
    const body = await parseJsonBody<InstallUpgradeRequest>(request);
    if (!body?.slotId || !body?.moduleId) {
      return NextResponse.json<InstallUpgradeResponse>({ error: "Missing slotId or moduleId." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await installUpgrade(auth.playerId, shipId, body.slotId, body.moduleId, body.tier);
    if (!result.ok) {
      return NextResponse.json<InstallUpgradeResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<InstallUpgradeResponse>({ data: result.data });
  });
}

export function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  return withServiceErrors("DELETE /api/game/ship/[shipId]/upgrades", async () => {
    const { shipId } = await params;
    const body = await parseJsonBody<RemoveUpgradeRequest>(request);
    if (!body?.slotId) {
      return NextResponse.json<RemoveUpgradeResponse>({ error: "Missing slotId." }, { status: 400 });
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await removeUpgrade(auth.playerId, shipId, body.slotId);
    if (!result.ok) {
      return NextResponse.json<RemoveUpgradeResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<RemoveUpgradeResponse>({ data: result.data });
  });
}
