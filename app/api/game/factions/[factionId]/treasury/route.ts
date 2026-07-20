import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getFactionTreasury, updateTreasuryPolicy } from "@/lib/services/treasury";
import { treasuryPolicySchema } from "@/lib/schemas/treasury";
import { parseJsonBody } from "@/lib/api/parse-json";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type {
  ApiResponse,
  FactionTreasuryResponse,
  UpdateTreasuryPolicyResponse,
} from "@/lib/types/api";

export function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ factionId: string }> },
) {
  return withServiceErrors(
    "GET /api/game/factions/[factionId]/treasury",
    async () => {
      const { factionId } = await params;
      return NextResponse.json<FactionTreasuryResponse>(
        { data: getFactionTreasury(factionId) },
        { headers: { "Cache-Control": "private, no-cache" } },
      );
    },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ factionId: string }> },
) {
  const { factionId } = await params;
  const body = await parseJsonBody<{
    taxLevel?: string;
    bands?: { maintenance?: number; logistics?: number; construction?: number };
  }>(request);
  const parsed = treasuryPolicySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = updateTreasuryPolicy(factionId, parsed.data);
  if (!result.ok) {
    return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 403 });
  }
  return NextResponse.json<UpdateTreasuryPolicyResponse>({ data: result.data });
}
