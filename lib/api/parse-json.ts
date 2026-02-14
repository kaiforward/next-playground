import { NextRequest } from "next/server";

/**
 * Parse JSON body from a NextRequest.
 * Returns the parsed body or null if the body is missing/malformed.
 *
 * Note: The `as T` cast is a typed boundary — request.json() returns `any`.
 * Callers should validate the shape (via Zod or null-checks) before use.
 */
export async function parseJsonBody<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
