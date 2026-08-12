import { NextRequest, NextResponse } from "next/server";
import { setSystemPin } from "@/lib/services/player-pins";
import { pinSchema } from "@/lib/schemas/player-pins";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse, PinsResponse } from "@/lib/types/api";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ systemId?: string; pinned?: boolean }>(request);
  const parsed = pinSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = setSystemPin(parsed.data);
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<PinsResponse>({ data: result.data });
}
