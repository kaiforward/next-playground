import type { ApiResponse } from "@/lib/types/api";

/**
 * Error thrown by the API wrappers, carrying the HTTP status alongside the
 * message so callers can branch on it (e.g. 409 "no world loaded").
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Typed fetch wrapper for API routes that return `ApiResponse<T>`.
 * Unwraps the response and throws on error so TanStack Query treats it as a failed query.
 */
export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new ApiError(json.error ?? "Unknown API error", res.status);
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
    throw new ApiError(json.error ?? "Unknown API error", res.status);
  }

  return json.data;
}

/**
 * Typed PATCH wrapper for partial-update API routes that return `ApiResponse<T>`.
 */
export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new ApiError(json.error ?? "Unknown API error", res.status);
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
    throw new ApiError(json.error ?? "Unknown API error", res.status);
  }

  return json.data;
}
