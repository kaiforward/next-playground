import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StarMap } from "@/components/map/star-map";
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
  PixiMapCanvas: ({ centerTarget }: { centerTarget?: { x: number; y: number; zoom: number } }) => (
    <div>centerTarget: {centerTarget ? `${centerTarget.x},${centerTarget.y}` : "none"}</div>
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

// A mutable stand-in for the router/URL state — `usePathname`/`useSearchParams` read it fresh on
// every call, so mutating it between renders and calling `rerender` is what simulates a client-side
// navigation (mirrors alert-run.test.tsx's own `transport` convention for a controllable hook read).
const nav = { pathname: "/", search: new URLSearchParams() };
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
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

beforeEach(() => {
  nav.pathname = "/";
  nav.search = new URLSearchParams();
});

function centerText(): string {
  return screen.getByText(/^centerTarget:/).textContent ?? "";
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
