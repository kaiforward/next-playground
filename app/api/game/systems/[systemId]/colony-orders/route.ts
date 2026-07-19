import { NextRequest, NextResponse } from "next/server";
import { orderColony } from "@/lib/services/construction-orders";
import type { ApiResponse, OrderColonyResponse } from "@/lib/types/api";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  const { systemId } = await params;
  const result = orderColony({ systemId });
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<OrderColonyResponse>({ data: result.data });
}
