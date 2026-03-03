import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlayer, isErrorResponse } from "@/lib/api/require-player";
import { getStaticTile } from "@/lib/services/static-tiles";
import { withServiceErrors } from "@/lib/api/with-service-errors";
import { TILE_COLS, TILE_ROWS } from "@/lib/engine/tiles";
import type { StaticTileResponse } from "@/lib/types/api";

export function GET(request: NextRequest) {
  return withServiceErrors("GET /api/game/systems/tile/static", async () => {
    const auth = await requirePlayer();
    if (isErrorResponse(auth)) return auth;

    const { searchParams } = request.nextUrl;
    const colStr = searchParams.get("col");
    const rowStr = searchParams.get("row");

    if (colStr === null || rowStr === null) {
      return NextResponse.json<StaticTileResponse>(
        { error: "Missing col or row parameter." },
        { status: 400 },
      );
    }

    const col = Number(colStr);
    const row = Number(rowStr);

    if (
      !Number.isInteger(col) || !Number.isInteger(row) ||
      col < 0 || col >= TILE_COLS ||
      row < 0 || row >= TILE_ROWS
    ) {
      return NextResponse.json<StaticTileResponse>(
        { error: `col must be 0-${TILE_COLS - 1}, row must be 0-${TILE_ROWS - 1}.` },
        { status: 400 },
      );
    }

    const data = await getStaticTile(col, row);
    return NextResponse.json<StaticTileResponse>(
      { data },
      { headers: { "Cache-Control": "private, max-age=31536000, immutable" } },
    );
  });
}
