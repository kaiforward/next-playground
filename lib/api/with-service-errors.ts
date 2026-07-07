import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/services/errors";
import type { ApiResponse } from "@/lib/types/api";

/**
 * Wraps an async handler body, catching ServiceError for typed JSON responses
 * and logging + returning 500 for unexpected errors.
 *
 * Usage in a route handler:
 *   export function GET() {
 *     return withServiceErrors("GET /api/game/world", async () => {
 *       const data = getGameWorld();
 *       return NextResponse.json<GameWorldResponse>({ data });
 *     });
 *   }
 */
export async function withServiceErrors(
  label: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json<ApiResponse<never>>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error(`${label} error:`, error);
    return NextResponse.json<ApiResponse<never>>(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
