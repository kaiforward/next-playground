import { NextRequest, NextResponse } from "next/server";
import { generateWorld } from "@/lib/world/gen";
import { setWorld } from "@/lib/world/store";
import { tickLoop } from "@/lib/world/tick-loop";
import { newGameSchema } from "@/lib/schemas/game-setup";
import { parseJsonBody } from "@/lib/api/parse-json";
import type { ApiResponse } from "@/lib/types/api";
import type { WorldMeta } from "@/lib/world/types";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<{ systemCount?: number; seed?: number }>(request);
  const result = newGameSchema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(", ");
    return NextResponse.json<ApiResponse<never>>({ error: message }, { status: 400 });
  }

  // The only permissible Math.random — a default seed picked outside the
  // deterministic tick path.
  const seed = result.data.seed ?? Math.floor(Math.random() * 2_000_000_000);
  tickLoop.setSpeed("paused");
  const world = generateWorld({ systemCount: result.data.systemCount, seed });
  setWorld(world);

  return NextResponse.json<ApiResponse<WorldMeta>>({ data: world.meta });
}
