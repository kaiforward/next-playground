import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, ApiError, isAuthError } from "../fetcher";

/** Stub global fetch to return a fresh Response (status + JSON body) per call. */
function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── apiFetch ────────────────────────────────────────────────────

describe("apiFetch", () => {
  it("returns the unwrapped data on success", async () => {
    mockFetch(200, { data: { value: 42 } });
    await expect(apiFetch<{ value: number }>("/api/x")).resolves.toEqual({ value: 42 });
  });

  it("throws an ApiError carrying the HTTP status on a 401", async () => {
    mockFetch(401, { error: "Not authenticated." });
    const err = await apiFetch("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.status).toBe(401);
      expect(err.message).toBe("Not authenticated.");
    }
  });

  it("preserves a non-auth error status (500)", async () => {
    mockFetch(500, { error: "Boom" });
    const err = await apiFetch("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.status).toBe(500);
    }
  });
});

// ── isAuthError ─────────────────────────────────────────────────

describe("isAuthError", () => {
  it("is true for a 401 ApiError", () => {
    expect(isAuthError(new ApiError("Not authenticated.", 401))).toBe(true);
  });

  it("is false for a non-401 ApiError", () => {
    expect(isAuthError(new ApiError("Boom", 500))).toBe(false);
  });

  it("is false for a plain Error", () => {
    expect(isAuthError(new Error("Not authenticated."))).toBe(false);
  });

  it("is false for non-error values", () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError("401")).toBe(false);
  });
});
