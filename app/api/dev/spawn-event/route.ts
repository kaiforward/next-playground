import { NextRequest, NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { parseJsonBody } from "@/lib/api/parse-json";
import { spawnEvent } from "@/lib/services/dev-tools";

export async function POST(request: NextRequest) {
  const guard = devOnly();
  if (guard) return guard;

  const body = await parseJsonBody<{
    systemId: string;
    eventType: string;
    severity?: number;
  }>(request);

  if (!body?.systemId || !body?.eventType) {
    return NextResponse.json({ error: "Missing systemId or eventType" }, { status: 400 });
  }

  const result = await spawnEvent(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}
