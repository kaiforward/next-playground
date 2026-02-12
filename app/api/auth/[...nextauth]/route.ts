import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth/auth";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { RATE_LIMIT_TIERS } from "@/lib/constants/rate-limit";

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  const limited = rateLimit({
    key: `auth:${getClientIp(request)}`,
    tier: RATE_LIMIT_TIERS.auth,
  });
  if (limited) return limited;

  return handlers.POST(request);
}
