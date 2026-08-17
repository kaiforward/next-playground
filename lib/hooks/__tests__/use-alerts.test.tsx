import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { makeQueryClient } from "@/lib/query/client";
import { QueryBoundary } from "@/components/ui/query-boundary";
import type { AlertResponse } from "@/lib/types/api";

function AlertCountProbe() {
  // Defensive on `alerts` itself (not `?.categories`): a real useSuspenseQuery guarantees `alerts`
  // is always defined once this renders, so this optional-chain exists only so a broken
  // implementation (e.g. a plain useQuery, `data: undefined` on first render) fails the "loading
  // shows first" assertion below cleanly instead of throwing out of render.
  const alerts = useAlerts();
  return <div data-testid="alert-count">{alerts?.categories.length}</div>;
}

/** The alert route's own envelope — `apiFetch` unwraps `data`, so a body typed as anything looser
 *  would let a fixture serialise a shape the real route can never send. */
function jsonResponse(body: AlertResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAlerts — a real useSuspenseQuery", () => {
  it("suspends (shows the Suspense fallback) until the fetch resolves, then renders the resolved data", async () => {
    const queryClient = makeQueryClient();
    let resolveFetch: (res: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div data-testid="loading">loading</div>}>
          <AlertCountProbe />
        </Suspense>
      </QueryClientProvider>,
    );

    // If useAlerts were a plain useQuery instead of useSuspenseQuery, `data` would start
    // undefined and AlertCountProbe would throw reading `.categories` off it rather than
    // suspending — this is what a real useSuspenseQuery buys: the fallback, not a crash.
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-count")).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch(jsonResponse({ data: { categories: [] } }));
    });

    await waitFor(() => expect(screen.getByTestId("alert-count")).toHaveTextContent("0"));
  });

  it("fetches the alert route the API actually serves", async () => {
    // The mock above answers any URL, so nothing else in this file would notice the hook asking for
    // the wrong path — a 404 in the browser behind a green suite. `/api/game/player/alerts` is the
    // route directory on disk (app/api/game/player/alerts/route.ts), transcribed here rather than
    // imported, so a rename that moves the route without moving the hook fails here.
    const queryClient = makeQueryClient();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ data: { categories: [] } })));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div data-testid="loading">loading</div>}>
          <AlertCountProbe />
        </Suspense>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("alert-count")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/game/player/alerts");
  });
});

describe("useAlerts — composed with QueryBoundary", () => {
  it("does not fetch during SSR render — QueryBoundary's mounted guard defers it past hydration", () => {
    const queryClient = makeQueryClient();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // renderToStaticMarkup runs a real server render pass: no useEffect fires (React SSR never
    // runs effects), so QueryBoundary's `mounted` state stays false and `children` — the tree
    // holding useAlerts — never mounts at all. A relative-URL fetch() inside useAlerts' queryFn
    // would crash on a real server (AGENTS.md → Next.js 16 gotchas); this proves it never runs.
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <QueryBoundary>
          <AlertCountProbe />
        </QueryBoundary>
      </QueryClientProvider>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(markup).not.toContain("alert-count");
  });
});
