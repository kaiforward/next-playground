import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StarMap } from "@/components/map/star-map";
import { DRAWER_WIDTH } from "@/lib/constants/layout";
import type { AtlasData } from "@/lib/types/game";
import type { GovernmentType } from "@/lib/types/game";

// Regression coverage for the "map flies back to a stale system on the next click" bug: a focus
// navigation (from the alert flyout or the Tracker) correctly recentres the camera, but the NEXT
// plain map click — which routes to a pathname carrying neither `?focus` nor `?loc` — used to fall
// back to `initialSelectedSystemId` (the page-load-time selection) and fly the camera back there.
// jsdom has no camera to watch pan, so what's assertable is the `centerTarget` prop StarMap computes
// and hands to PixiMapCanvas — not the visual pan itself. PixiMapCanvas is stubbed to render that
// prop as plain text (no test-only attribute or class), which is what every assertion below reads.

vi.mock("@/components/map/pixi/pixi-map-canvas", () => ({
  PixiMapCanvas: ({
    centerTarget,
    centerOffsetX,
  }: {
    centerTarget?: { x: number; y: number; zoom: number };
    centerOffsetX?: number;
  }) => (
    <>
      <div>centerTarget: {centerTarget ? `${centerTarget.x},${centerTarget.y}` : "none"}</div>
      <div>centerOffsetX: {String(centerOffsetX)}</div>
    </>
  ),
}));

vi.mock("@/components/map/map-right-rail", () => ({ MapRightRail: () => null }));
vi.mock("@/components/alerts/alert-run", () => ({ AlertRun: () => null }));
vi.mock("@/components/map/map-zoom-debug", () => ({ MapZoomDebug: () => null }));

vi.mock("@/components/dev-tools/dev-overlay-context", () => ({
  useDevOverlay: () => ({ showMapDebug: false, setShowMapDebug: vi.fn() }),
}));

// Every query-backed map hook is replaced with a plain synchronous return — none of them are what
// this test is about, and mocking them out avoids needing a real QueryClientProvider/Suspense tree
// (see alert-run.test.tsx's own convention of mocking hooks directly rather than integrating the
// real query flow).
vi.mock("@/lib/hooks/use-static-tiles", () => ({
  useStaticTiles: () => ({ systems: [], onViewportChange: vi.fn(), active: false, zoom: 0 }),
}));
vi.mock("@/lib/hooks/use-visibility", () => ({
  useVisibility: () => ({ visibleSystemIds: new Set<string>() }),
}));
vi.mock("@/lib/hooks/use-ownership", () => ({ useOwnership: () => new Map() }));
vi.mock("@/lib/hooks/use-map-mode", () => ({
  useMapMode: () => ({ mode: "political", setMode: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-map-overlays", () => ({
  useMapOverlays: () => ({ overlays: { logistics: false }, toggle: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-trade-flow", () => ({ useTradeFlow: () => ({ logisticsEdges: [] }) }));
vi.mock("@/lib/hooks/use-stability", () => ({ useStability: () => new Map() }));
vi.mock("@/lib/hooks/use-population", () => ({ usePopulation: () => new Map() }));
vi.mock("@/lib/hooks/use-development", () => ({ useDevelopment: () => new Map() }));
vi.mock("@/lib/hooks/use-migration", () => ({ useMigration: () => new Map() }));
vi.mock("@/lib/hooks/use-provision", () => ({ useProvision: () => new Map() }));

// A mutable stand-in for the route/URL state — `useRouteInfo()` reads it fresh on every call, so
// mutating it between renders and calling `rerender` is what simulates a client-side navigation
// (mirrors alert-run.test.tsx's own `transport` convention for a controllable hook read).
const nav = { pathname: "/", search: new URLSearchParams() };
const push = vi.fn();
vi.mock("@/components/ui/link-provider", () => ({
  useNavigate: () => push,
  useRouteInfo: () => ({ pathname: nav.pathname, searchParams: nav.search }),
}));

const GOV: GovernmentType = "frontier";

const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 2, seed: 1 },
  regions: [
    { id: "region-1", name: "Region", dominantEconomy: "agricultural", dominantFactionId: null, dominantGovernmentType: GOV, x: 0, y: 0 },
  ],
  systems: [
    { id: "home-1", x: 5, y: 5, regionId: "region-1", factionId: null, economyType: "agricultural", isGateway: false, developed: true, sunClass: "yellow" },
    { id: "sys-a", x: 50, y: 60, regionId: "region-1", factionId: null, economyType: "agricultural", isGateway: false, developed: true, sunClass: "yellow" },
    { id: "sys-b", x: 70, y: 80, regionId: "region-1", factionId: null, economyType: "agricultural", isGateway: false, developed: true, sunClass: "yellow" },
  ],
  connections: [],
  factions: [],
  player: { controlledFactionId: "player-faction", homeworldSystemId: "home-1" },
};

const JSDOM_DEFAULT_WIDTH = window.innerWidth;

beforeEach(() => {
  nav.pathname = "/";
  nav.search = new URLSearchParams();
  // The offset formula reads `window.innerWidth`, and the tests below move it — restored here so
  // one of them cannot leak a viewport into the next.
  window.innerWidth = JSDOM_DEFAULT_WIDTH;
});

function centerText(): string {
  return screen.getByText(/^centerTarget:/).textContent ?? "";
}

function offsetText(): string {
  return screen.getByText(/^centerOffsetX:/).textContent ?? "";
}

describe("StarMap — camera recentring only follows an explicit ?focus, never a plain click", () => {
  it("does not fly back to the page-load selection on the click that follows a focus navigation", () => {
    const { rerender } = render(
      <StarMap atlas={ATLAS} initialSelectedSystemId="home-1" />,
    );
    // Initial mount: no ?focus, so the page-load fallback (initialSelectedSystemId's coordinates)
    // is what seeds the very first centre.
    expect(centerText()).toBe("centerTarget: 5,5");

    // A focus navigation (the alert flyout / Tracker's "Show on Map") — recentres correctly.
    nav.pathname = "/system/sys-a";
    nav.search = new URLSearchParams("focus=10,20&loc=1");
    rerender(<StarMap atlas={ATLAS} initialSelectedSystemId="home-1" />);
    expect(centerText()).toBe("centerTarget: 10,20");

    // The NEXT plain map click — routes to a different system with neither `focus` nor `loc` set,
    // exactly like `onSelectSystem`'s own `router.push` in star-map.tsx. The camera must stay where
    // the focus navigation left it, not jump back to home-1's page-load coordinates.
    nav.pathname = "/system/sys-b";
    nav.search = new URLSearchParams();
    rerender(<StarMap atlas={ATLAS} initialSelectedSystemId="home-1" />);
    expect(centerText()).toBe("centerTarget: 10,20");
  });
});

describe("StarMap — the recentre offset clears the docked drawer, capped by the viewport", () => {
  it("is zero on the root route, where no drawer is docked", () => {
    render(<StarMap atlas={ATLAS} initialSelectedSystemId="home-1" />);
    expect(offsetText()).toBe("centerOffsetX: 0");
  });

  it("is half the drawer's own width on a panel route", () => {
    // The drawer is `w-[560px] max-w-full`, so the offset shifts the centre point by half of
    // whatever it actually covers — the full DRAWER_WIDTH on any viewport wide enough for it.
    window.innerWidth = 1400;
    nav.pathname = "/system/sys-a";
    render(<StarMap atlas={ATLAS} initialSelectedSystemId="home-1" />);
    expect(offsetText()).toBe(`centerOffsetX: ${DRAWER_WIDTH / 2}`);
  });

  it("is capped by the viewport when the window is narrower than the drawer", () => {
    // `max-w-full` is the half of the drawer's own sizing the formula has to honour: on a viewport
    // narrower than 560px the drawer covers the whole width, and an uncapped offset would push the
    // focused system off the visible area entirely.
    window.innerWidth = 400;
    nav.pathname = "/system/sys-a";
    render(<StarMap atlas={ATLAS} initialSelectedSystemId="home-1" />);
    expect(offsetText()).toBe("centerOffsetX: 200");
  });
});
