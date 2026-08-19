import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useRoute } from "../routes";

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
