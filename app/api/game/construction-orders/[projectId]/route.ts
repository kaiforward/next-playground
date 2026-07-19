import { NextRequest, NextResponse } from "next/server";
import { cancelOrder } from "@/lib/services/construction-orders";
import type { ApiResponse, CancelOrderResponse } from "@/lib/types/api";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const result = cancelOrder({ projectId });
  if (!result.ok) return NextResponse.json<ApiResponse<never>>({ error: result.error }, { status: 400 });
  return NextResponse.json<CancelOrderResponse>({ data: result.data });
}
