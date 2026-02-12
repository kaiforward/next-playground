import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";

export function proxy(request: NextRequest) {
  const limited = rateLimit({
    key: `ip:${getClientIp(request)}`,
    tier: RATE_LIMIT_TIERS.global,
  });
  if (limited) return limited;

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/register", "/api/auth/:path*", "/api/game/:path*"],
};
