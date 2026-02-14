import { NextRequest, NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { parseJsonBody } from "@/lib/api/parse-json";
import { advanceTicks } from "@/lib/services/dev-tools";

export async function POST(request: NextRequest) {
  const guard = devOnly();
  if (guard) return guard;

  const body = await parseJsonBody<{ count: number }>(request);
  if (!body?.count) {
    return NextResponse.json({ error: "Missing count" }, { status: 400 });
  }

  const result = await advanceTicks(body.count);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}
