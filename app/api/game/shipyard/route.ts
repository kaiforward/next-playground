import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireMutationPlayer, isErrorResponse } from "@/lib/api/require-player";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { parseJsonBody } from "@/lib/api/parse-json";
import { purchaseShip } from "@/lib/services/shipyard";
import type { ShipPurchaseRequest, ShipPurchaseResponse } from "@/lib/types/api";

export function POST(request: NextRequest) {
  return withServiceErrors("POST /api/game/shipyard", async () => {
    const body = await parseJsonBody<ShipPurchaseRequest>(request);
    if (!body) {
      return NextResponse.json<ShipPurchaseResponse>(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const auth = await requireMutationPlayer();
    if (isErrorResponse(auth)) return auth;

    const result = await purchaseShip(auth.playerId, body.systemId, body.shipType);

    if (!result.ok) {
      return NextResponse.json<ShipPurchaseResponse>(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json<ShipPurchaseResponse>({ data: result.data });
  });
}
