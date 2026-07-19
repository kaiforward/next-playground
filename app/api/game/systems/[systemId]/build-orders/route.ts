import { NextRequest, NextResponse } from "next/server";
import { orderBuild } from "@/lib/services/construction-orders";
import { orderBuildSchema } from "@/lib/schemas/construction-orders";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse, OrderBuildResponse } from "@/lib/types/api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  const { systemId } = await params;
  const body = await parseJsonBody<{ buildingType?: string; levels?: number }>(request);
  const parsed = orderBuildSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }
  const result = orderBuild({ systemId, ...parsed.data });
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<OrderBuildResponse>({ data: result.data });
}
