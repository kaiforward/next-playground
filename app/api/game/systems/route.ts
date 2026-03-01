import { NextResponse } from "next/server";
import { getUniverse } from "@/lib/services/universe";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import type { UniverseResponse } from "@/lib/types/api";

export function GET() {
  return withServiceErrors("GET /api/game/systems", async () => {
    const data = await getUniverse();
    return NextResponse.json<UniverseResponse>({ data });
  });
}
