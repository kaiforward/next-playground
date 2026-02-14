import { NextRequest, NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { parseJsonBody } from "@/lib/api/parse-json";
import { controlTick } from "@/lib/services/dev-tools";

export async function POST(request: NextRequest) {
  const guard = devOnly();
  if (guard) return guard;

  const body = await parseJsonBody<{
    action: "pause" | "resume" | "setRate";
    tickRate?: number;
  }>(request);

  if (!body?.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const result = await controlTick(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}
