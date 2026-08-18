import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch, apiMutate, apiPatch, apiDelete, ApiError } from "../fetcher";

/**
 * Stub global fetch to return a fresh Response (status + JSON body) per call. The returned spy
 * records the `(url, init)` each wrapper actually sent — the only observable of the shared
 * request-building path.
 */
function mockFetch(status: number, body: unknown) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
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

  it("sends no request init at all — a GET must not carry a method or a body", async () => {
    const spy = mockFetch(200, { data: { value: 1 } });
    await apiFetch("/api/x");
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
  });
});

// ── apiMutate / apiPatch / apiDelete ────────────────────────────

/** Each body-carrying wrapper, paired with the HTTP method it must send. */
const bodyWrappers: Array<[string, (url: string, body?: unknown) => Promise<unknown>, string]> = [
  ["apiMutate", apiMutate, "POST"],
  ["apiPatch", apiPatch, "PATCH"],
  ["apiDelete", apiDelete, "DELETE"],
];

describe.each(bodyWrappers)("%s", (_name, send, method) => {
  it(`sends ${method} with a JSON body and the JSON content type`, async () => {
    const spy = mockFetch(200, { data: { ok: true } });
    await send("/api/x", { count: 3 });
    const init = spy.mock.calls[0]?.[1];
    expect(init?.method).toBe(method);
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe(JSON.stringify({ count: 3 }));
  });

  it("omits both the body and the content type when no body is given", async () => {
    const spy = mockFetch(200, { data: { ok: true } });
    await send("/api/x");
    const init = spy.mock.calls[0]?.[1];
    expect(init?.method).toBe(method);
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("unwraps data on success and throws an ApiError carrying the status on failure", async () => {
    mockFetch(200, { data: { value: 7 } });
    await expect(send("/api/x", {})).resolves.toEqual({ value: 7 });

    mockFetch(409, { error: "No world loaded." });
    const err = await send("/api/x", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.status).toBe(409);
      expect(err.message).toBe("No world loaded.");
    }
  });
});
