import type { ApiResponse } from "@/lib/types/api";

/**
 * Typed fetch wrapper for API routes that return `ApiResponse<T>`.
 * Unwraps the response and throws on error so TanStack Query treats it as a failed query.
 */
export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new Error(json.error ?? "Unknown API error");
  }

  return json.data;
}
