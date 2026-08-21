import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useRoute, resolveRouteGate, shouldRedirectToStart } from "../routes";
import { createGameStore, selectIsReplacing } from "@/lib/store/game-store";

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

// The world-existence gate — pinned as pure functions so the bugs they fix (both
// found on real-browser Gate C smoke) have fast, no-Worker regression tests.
describe("resolveRouteGate", () => {
  it("shows boot-loading before the very first frame lands, regardless of route", () => {
    expect(resolveRouteGate(null, true, false)).toBe("boot-loading");
    expect(resolveRouteGate(null, false, false)).toBe("boot-loading");
  });

  it("shows boot-loading for a non-start route while no world exists (briefly, before the redirect effect fires)", () => {
    expect(resolveRouteGate(0, false, false)).toBe("boot-loading");
  });

  it("renders the start route normally once the first frame has landed, world or no world", () => {
    expect(resolveRouteGate(0, true, false)).toBe("start");
    expect(resolveRouteGate(42, true, false)).toBe("start");
  });

  it("renders the matched route normally once a world exists", () => {
    expect(resolveRouteGate(42, false, false)).toBe("route");
  });

  it("does not fall back to boot-loading on a mid-game world-replacement reset (worldVersion 0, still on /start)", () => {
    // The exact scenario `GameStore.beginWorldReplacement()` exists for: the start screen is
    // already mounted (routeIsStart=true) and dispatches newGame/loadGame, which resets
    // worldVersion to 0 — this must render "start", never "boot-loading", or the dialog showing
    // the pending "Generating…" button would be torn down mid-submit.
    expect(resolveRouteGate(0, true, false)).toBe("start");
  });

  it("shows boot-loading (not start) on a non-start route while a replacement is in flight", () => {
    expect(resolveRouteGate(0, false, true)).toBe("boot-loading");
  });
});

describe("shouldRedirectToStart", () => {
  it("redirects on a genuine no-world boot", () => {
    expect(shouldRedirectToStart(0, false, false)).toBe(true);
  });

  it("never redirects while a route replacement is in flight", () => {
    expect(shouldRedirectToStart(0, false, true)).toBe(false);
  });

  it("never redirects while already on /start", () => {
    expect(shouldRedirectToStart(0, true, false)).toBe(false);
  });

  it("never redirects once a world exists", () => {
    expect(shouldRedirectToStart(42, false, false)).toBe(false);
  });
});

// The real Gate C smoke finding (owner, `npx vite dev`): "New Game kicks the user straight back to
// the start screen." Root cause — `beginWorldReplacement()` resets `worldVersion` to `0` for the
// WHOLE swap window, but `useNewGameMutation`'s `mutateAsync` resolves (and the caller navigates to
// the map route) on the command RESULT, a separate and EARLIER postMessage than the new world's own
// state frame. Gating on `worldVersion === 0` alone reads that window as "no world" and redirects
// straight back to `/start` before the frame ever lands. Reproduced here against the REAL store
// (`createGameStore`), driving `resolveRouteGate`/`shouldRedirectToStart` exactly the way
// `client/main.tsx`'s `RouteBody` does, at exactly the point in the sequence the bug lives.
describe("the New Game swap-window redirect (Gate C smoke finding A)", () => {
  it("stays on the map route as boot-loading, never redirecting to /start, between the command result and the new world's frame — then renders the route once the frame lands", () => {
    const store = createGameStore();
    // The player is mid-game: a live world is already seeded.
    store.applyStateFrame({ frameSeq: 1, worldVersion: 5, slices: {} });

    // New Game dispatched — `useNewGameMutation` resets the store synchronously (Proves 4).
    store.beginWorldReplacement();

    // The command RESULT resolves here (the mutation's own `mutateAsync` continuation) and the
    // caller navigates to the map route — `route.name === "start"` is now false. The new world's
    // state frame has NOT arrived yet: this is the exact window the real bug lives in.
    let snapshot = store.getSnapshot();
    const isReplacing = selectIsReplacing(snapshot);
    const routeIsStart = false;

    expect(isReplacing).toBe(true);
    expect(shouldRedirectToStart(snapshot.worldVersion, routeIsStart, isReplacing)).toBe(false);
    expect(resolveRouteGate(snapshot.worldVersion, routeIsStart, isReplacing)).toBe("boot-loading");

    // The new world's own frame lands (worldVersion climbs past the replacement floor).
    store.applyStateFrame({ frameSeq: 1, worldVersion: 6, slices: {} });
    snapshot = store.getSnapshot();
    const isReplacingAfter = selectIsReplacing(snapshot);

    expect(isReplacingAfter).toBe(false);
    expect(resolveRouteGate(snapshot.worldVersion, routeIsStart, isReplacingAfter)).toBe("route");
  });

  it("still redirects to /start on a genuine fresh-boot no-world frame (no replacement in flight)", () => {
    const store = createGameStore();
    // The worker's own world-less boot frame (`noWorldStateFrame`, worldVersion: 0) — never
    // preceded by `beginWorldReplacement`, so `replacementFloor` was never latched.
    store.applyStateFrame({ frameSeq: 1, worldVersion: 0, slices: {} });

    const snapshot = store.getSnapshot();
    const isReplacing = selectIsReplacing(snapshot);

    expect(isReplacing).toBe(false);
    expect(shouldRedirectToStart(snapshot.worldVersion, false, isReplacing)).toBe(true);
    expect(resolveRouteGate(snapshot.worldVersion, false, isReplacing)).toBe("boot-loading");
  });
});
