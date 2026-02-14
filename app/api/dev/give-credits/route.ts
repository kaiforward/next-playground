import { NextRequest, NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { parseJsonBody } from "@/lib/api/parse-json";
import { giveCredits } from "@/lib/services/dev-tools";

export async function POST(request: NextRequest) {
  const guard = devOnly();
  if (guard) return guard;

  const body = await parseJsonBody<{ playerId: string; amount: number }>(request);
  if (!body?.playerId || body?.amount === undefined) {
    return NextResponse.json({ error: "Missing playerId or amount" }, { status: 400 });
  }

  const result = await giveCredits(body.playerId, body.amount);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}
