import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { parseJsonBody } from "@/lib/api/parse-json";
import { installUpgrade, removeUpgrade } from "@/lib/services/upgrades";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { InstallUpgradeRequest, InstallUpgradeResponse, RemoveUpgradeRequest, RemoveUpgradeResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;
    const body = await parseJsonBody<InstallUpgradeRequest>(request);
    if (!body?.slotId || !body?.moduleId) {
      return NextResponse.json<InstallUpgradeResponse>({ error: "Missing slotId or moduleId." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<InstallUpgradeResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await installUpgrade(playerId, shipId, body.slotId, body.moduleId, body.tier);
    if (!result.ok) {
      return NextResponse.json<InstallUpgradeResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<InstallUpgradeResponse>({ data: result.data });
  } catch (error) {
    console.error("POST /api/game/ship/[shipId]/upgrades error:", error);
    return NextResponse.json<InstallUpgradeResponse>({ error: "Failed to install upgrade." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shipId: string }> },
) {
  try {
    const { shipId } = await params;
    const body = await parseJsonBody<RemoveUpgradeRequest>(request);
    if (!body?.slotId) {
      return NextResponse.json<RemoveUpgradeResponse>({ error: "Missing slotId." }, { status: 400 });
    }

    const playerId = await getSessionPlayerId();
    if (!playerId) {
      return NextResponse.json<RemoveUpgradeResponse>({ error: "Player not found." }, { status: 404 });
    }

    const mutationLimit = rateLimit({ key: `mutation:${playerId}`, tier: RATE_LIMIT_TIERS.mutation });
    if (mutationLimit) return mutationLimit;

    const result = await removeUpgrade(playerId, shipId, body.slotId);
    if (!result.ok) {
      return NextResponse.json<RemoveUpgradeResponse>({ error: result.error }, { status: result.status });
    }

    return NextResponse.json<RemoveUpgradeResponse>({ data: result.data });
  } catch (error) {
    console.error("DELETE /api/game/ship/[shipId]/upgrades error:", error);
    return NextResponse.json<RemoveUpgradeResponse>({ error: "Failed to remove upgrade." }, { status: 500 });
  }
}
