import { NextRequest, NextResponse } from "next/server";
import { getSystemDetail } from "@/lib/services/universe";
import { ServiceError } from "@/lib/services/errors";
import type { SystemDetailResponse } from "@/lib/types/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  try {
    const { systemId } = await params;
    const data = await getSystemDetail(systemId);
    return NextResponse.json<SystemDetailResponse>({ data });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<SystemDetailResponse>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/game/systems/[systemId] error:", error);
    return NextResponse.json<SystemDetailResponse>(
      { error: "Failed to fetch system details." },
      { status: 500 },
    );
  }
}
