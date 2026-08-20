import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useRoute, resolveRouteGate } from "../routes";

function RouteProbe() {
  const route = useRoute();
  return <div data-testid="route">{JSON.stringify(route)}</div>;
}

afterEach(() => {
  window.history.pushState(null, "", "/");
});

describe("useRoute", () => {
  it("matches a system/faction route with an explicit tab segment, and re-renders on back/forward navigation", async () => {
    window.history.pushState(null, "", "/system/42/population");
    render(<RouteProbe />);
    expect(screen.getByTestId("route")).toHaveTextContent(
      JSON.stringify({ name: "system", systemId: "42", tab: "population" }),
    );

    act(() => {
      window.history.pushState(null, "", "/factions/7/diplomacy");
    });
    expect(screen.getByTestId("route")).toHaveTextContent(
      JSON.stringify({ name: "faction", factionId: "7", tab: "diplomacy" }),
    );

    await act(async () => {
      window.history.back();
      // `history.back()` fires its `popstate` asynchronously (a queued task, not a microtask) —
      // this yields the event loop so the patched listener in wouter's browser hook has run before
      // the assertion below reads the DOM.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByTestId("route")).toHaveTextContent(
        JSON.stringify({ name: "system", systemId: "42", tab: "population" }),
      ),
    );

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByTestId("route")).toHaveTextContent(
        JSON.stringify({ name: "faction", factionId: "7", tab: "diplomacy" }),
      ),
    );
  });

  it("matches the bare base path as the Overview tab (empty segment) — today's live URL shape", () => {
    window.history.pushState(null, "", "/system/42");
    render(<RouteProbe />);
    expect(screen.getByTestId("route")).toHaveTextContent(
      JSON.stringify({ name: "system", systemId: "42", tab: "" }),
    );
  });

  it("matches the bare faction base path as the Overview tab too", () => {
    window.history.pushState(null, "", "/factions/7");
    render(<RouteProbe />);
    expect(screen.getByTestId("route")).toHaveTextContent(
      JSON.stringify({ name: "faction", factionId: "7", tab: "" }),
    );
  });

  it("re-renders from the bare Overview path to a tabbed path on forward navigation", async () => {
    window.history.pushState(null, "", "/system/42");
    render(<RouteProbe />);
    expect(screen.getByTestId("route")).toHaveTextContent(
      JSON.stringify({ name: "system", systemId: "42", tab: "" }),
    );

    act(() => {
      window.history.pushState(null, "", "/system/42/market");
    });
    expect(screen.getByTestId("route")).toHaveTextContent(
      JSON.stringify({ name: "system", systemId: "42", tab: "market" }),
    );

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByTestId("route")).toHaveTextContent(
        JSON.stringify({ name: "system", systemId: "42", tab: "" }),
      ),
    );
  });

  it("falls back to the map route for a path no pattern matches", () => {
    window.history.pushState(null, "", "/totally/unknown/path");
    render(<RouteProbe />);
    expect(screen.getByTestId("route")).toHaveTextContent(JSON.stringify({ name: "map" }));
  });

  it("falls back to the map route at the root path", () => {
    window.history.pushState(null, "", "/");
    render(<RouteProbe />);
    expect(screen.getByTestId("route")).toHaveTextContent(JSON.stringify({ name: "map" }));
  });
});

// Build plan Task 11's world-existence gate — pinned as a pure function so the exact bug it fixes
// (a mid-game world-replacement reset tearing the already-mounted start screen down into the
// generic boot-loading state) has a fast, no-Worker regression test.
describe("resolveRouteGate", () => {
  it("shows boot-loading before the very first frame lands, regardless of route", () => {
    expect(resolveRouteGate(null, true)).toBe("boot-loading");
    expect(resolveRouteGate(null, false)).toBe("boot-loading");
  });

  it("shows boot-loading for a non-start route while no world exists (briefly, before the redirect effect fires)", () => {
    expect(resolveRouteGate(0, false)).toBe("boot-loading");
  });

  it("renders the start route normally once the first frame has landed, world or no world", () => {
    expect(resolveRouteGate(0, true)).toBe("start");
    expect(resolveRouteGate(42, true)).toBe("start");
  });

  it("renders the matched route normally once a world exists", () => {
    expect(resolveRouteGate(42, false)).toBe("route");
  });

  it("does not fall back to boot-loading on a mid-game world-replacement reset (worldVersion 0, still on /start)", () => {
    // The exact scenario `GameStore.beginWorldReplacement()` exists for: the start screen is
    // already mounted (routeIsStart=true) and dispatches newGame/loadGame, which resets
    // worldVersion to 0 — this must render "start", never "boot-loading", or the dialog showing
    // the pending "Generating…" button would be torn down mid-submit.
    expect(resolveRouteGate(0, true)).toBe("start");
  });
});
