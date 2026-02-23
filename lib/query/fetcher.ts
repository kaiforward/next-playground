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

/**
 * Typed POST wrapper for mutation API routes that return `ApiResponse<T>`.
 * Handles JSON serialization, error unwrapping, and typed response.
 */
export async function apiMutate<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new Error(json.error ?? "Unknown API error");
  }

  return json.data;
}

/**
 * Typed DELETE wrapper for mutation API routes that return `ApiResponse<T>`.
 * Optionally sends a JSON body.
 */
export async function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new Error(json.error ?? "Unknown API error");
  }

  return json.data;
}
