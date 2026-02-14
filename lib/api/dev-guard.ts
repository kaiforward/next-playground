import { NextResponse } from "next/server";

/**
 * Guard for dev-only API routes.
 * Returns a 403 response if not in development mode, null otherwise.
 */
export function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Dev tools are only available in development mode." },
      { status: 403 },
    );
  }
  return null;
}
