import { NextRequest } from "next/server";

/**
 * Parse JSON body from a NextRequest.
 * Returns the parsed body or null if the body is missing/malformed.
 */
export async function parseJsonBody<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
