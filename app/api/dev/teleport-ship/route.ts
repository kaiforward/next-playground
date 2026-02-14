import { NextRequest, NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { parseJsonBody } from "@/lib/api/parse-json";
import { teleportShip } from "@/lib/services/dev-tools";

export async function POST(request: NextRequest) {
  const guard = devOnly();
  if (guard) return guard;

  const body = await parseJsonBody<{ shipId: string; systemId: string }>(request);
  if (!body?.shipId || !body?.systemId) {
    return NextResponse.json({ error: "Missing shipId or systemId" }, { status: 400 });
  }

  const result = await teleportShip(body.shipId, body.systemId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}
