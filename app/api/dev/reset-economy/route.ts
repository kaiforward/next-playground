import { NextResponse } from "next/server";
import { devOnly } from "@/lib/api/dev-guard";
import { resetEconomy } from "@/lib/services/dev-tools";

export async function POST() {
  const guard = devOnly();
  if (guard) return guard;

  const result = await resetEconomy();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ data: result.data });
}
