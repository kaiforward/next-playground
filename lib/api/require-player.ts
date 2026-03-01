import { NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/auth/get-player";
import { rateLimit } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";
import type { ApiResponse } from "@/lib/types/api";

/**
 * Auth gate for read routes.
 * Returns the player ID or a 401 response.
 */
export async function requirePlayer(): Promise<
  { playerId: string } | NextResponse<ApiResponse<never>>
> {
  const playerId = await getSessionPlayerId();
  if (!playerId) {
    return NextResponse.json<ApiResponse<never>>(
      { error: "Not authenticated." },
      { status: 401 },
    );
  }
  return { playerId };
}

/**
 * Auth + rate-limit gate for mutation routes.
 * Returns the player ID or an error response (401 or 429).
 */
export async function requireMutationPlayer(): Promise<
  { playerId: string } | NextResponse<ApiResponse<never>>
> {
  const playerId = await getSessionPlayerId();
  if (!playerId) {
    return NextResponse.json<ApiResponse<never>>(
      { error: "Not authenticated." },
      { status: 401 },
    );
  }

  const limited = rateLimit({
    key: `mutation:${playerId}`,
    tier: RATE_LIMIT_TIERS.mutation,
  });
  if (limited) return limited;

  return { playerId };
}

/** Type guard: true when the result is a NextResponse (i.e. an error). */
export function isErrorResponse(
  result: { playerId: string } | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
