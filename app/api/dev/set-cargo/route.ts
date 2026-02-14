import { NextRequest, NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { parseJsonBody } from "@/lib/api/parse-json";
import { setShipCargo } from "@/lib/services/dev-tools";

export async function POST(request: NextRequest) {
  const guard = devOnly();
  if (guard) return guard;

  const body = await parseJsonBody<{
    shipId: string;
    cargo: { goodId: string; quantity: number }[];
  }>(request);

  if (!body?.shipId || !body?.cargo) {
    return NextResponse.json({ error: "Missing shipId or cargo" }, { status: 400 });
  }

  const result = await setShipCargo(body.shipId, body.cargo);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.data });
}
