import { NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { getEconomySnapshot } from "@/lib/services/dev-tools";

export async function GET() {
  const guard = devOnly();
  if (guard) return guard;

  const result = await getEconomySnapshot();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ data: result.data });
}
