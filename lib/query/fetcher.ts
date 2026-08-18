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
 * The `ApiResponse<T>` envelope check every wrapper below shares: unwrap `data`,
 * or throw with the response's own status so TanStack Query treats it as a
 * failed query. A response carrying no `data` is a failure even without an
 * `error` string.
 */
async function unwrap<T>(res: Response): Promise<T> {
  const json: ApiResponse<T> = await res.json();

  if (json.error || !json.data) {
    throw new ApiError(json.error ?? "Unknown API error", res.status);
  }

  return json.data;
}

/**
 * The body-carrying half of the wrappers (POST/PATCH/DELETE): JSON serialisation,
 * then the shared unwrap. An omitted body sends no `Content-Type` header and no
 * payload at all — a bodyless DELETE must not advertise a JSON body it isn't sending.
 */
async function apiSend<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return unwrap<T>(res);
}

/**
 * Typed fetch wrapper for API routes that return `ApiResponse<T>`.
 * Unwraps the response and throws on error so TanStack Query treats it as a failed query.
 */
export async function apiFetch<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url));
}

/**
 * Typed POST wrapper for mutation API routes that return `ApiResponse<T>`.
 * Handles JSON serialisation, error unwrapping, and typed response.
 */
export function apiMutate<T>(url: string, body?: unknown): Promise<T> {
  return apiSend<T>("POST", url, body);
}

/**
 * Typed PATCH wrapper for partial-update API routes that return `ApiResponse<T>`.
 */
export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiSend<T>("PATCH", url, body);
}

/**
 * Typed DELETE wrapper for mutation API routes that return `ApiResponse<T>`.
 * Optionally sends a JSON body.
 */
export function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  return apiSend<T>("DELETE", url, body);
}
