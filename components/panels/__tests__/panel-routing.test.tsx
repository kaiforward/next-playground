/**
 * Task 9's own Proves entries for `components/panels/**` + the Vite shell's route switch
 * (`client/main.tsx`'s `RouteBody`, exercised here via a small stand-in that mirrors its `switch`):
 *
 *  1. a panel URL naming an absent system/faction renders the not-found state, not blank/loading.
 *  2. no `role="status"` fallback ever mounts on a panel open (the `QueryBoundary` Suspense/
 *     mounted-guard behaviour this task retires).
 *  3. back/forward across panels restores content.
 *
 * (Proves 4 — the map's click-frame selection ring — is browser-only; see the PR description's
 * does-not-prove list.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { seedSlices } from "@/lib/hooks/__tests__/store-fixture";
import { WouterRuntimeProvider } from "@/client/wouter-link";
import { useRoute } from "@/client/routes";
import { TickProvider } from "@/lib/hooks/use-tick-context";
import { SystemPanel } from "@/components/panels/system-panel";
import { FactionPanel } from "@/components/panels/faction-panel";
import type { UniverseData } from "@/lib/types/game";
import type { FactionDetail } from "@/lib/services/factions";

// jsdom implements no scroll methods at all — `DetailPanel`'s mount-scroll-reset effect calls
// `bodyRef.current.scrollTo`, which is simply absent on a jsdom element (not a "cannot scroll",
// literally undefined), so every test rendering `DetailPanel` needs a stand-in.
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

/** A minimal stand-in for `client/main.tsx`'s `RouteBody` — just the panel half, since these tests
 *  are about panel routing, not the map. */
function PanelRoot() {
  const route = useRoute();
  switch (route.name) {
    case "system":
      return <SystemPanel systemId={route.systemId} tab={route.tab} />;
    case "faction":
      return <FactionPanel factionId={route.factionId} tab={route.tab} />;
    default:
      return null;
  }
}

function renderAt(path: string) {
  window.history.pushState(null, "", path);
  return render(
    <WouterRuntimeProvider>
      <TickProvider>
        <PanelRoot />
      </TickProvider>
    </WouterRuntimeProvider>,
  );
}

afterEach(() => {
  window.history.pushState(null, "", "/");
});

const UNIVERSE: UniverseData = {
  regions: [],
  systems: [
    {
      id: "sys-a",
      name: "Sunnyvale",
      economyType: "agricultural",
      x: 10,
      y: 20,
      description: "",
      regionId: "",
      factionId: null,
      isGateway: false,
      developed: true,
      sunClass: "yellow",
    },
  ],
  connections: [],
  factions: [],
};

const FACTION_DETAIL: FactionDetail = {
  id: "fac-a",
  name: "The Combine",
  description: "",
  color: "#22c55e",
  status: "major",
  isPlayer: false,
  governmentType: "federation",
  governmentName: "Federation",
  governmentDescription: "",
  doctrine: "expansionist",
  doctrineName: "Expansionist",
  doctrineDescription: "",
  homeworldId: "sys-a",
  homeworldName: "Sunnyvale",
  alliances: [],
  relations: [],
  recentEvents: [],
  territorySize: 1,
  territory: [],
};

describe("SystemPanel / FactionPanel — not-found state for an absent entity", () => {
  it("a system id absent from the universe renders the not-found EmptyState, not blank or loading", () => {
    seedSlices({ universe: UNIVERSE });
    renderAt("/system/ghost-system");

    expect(
      screen.getByText("This system no longer exists in the current galaxy."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a faction id absent from the snapshot renders the not-found EmptyState, not blank or loading", () => {
    seedSlices({ factionDetail: {} });
    renderAt("/factions/ghost-faction");

    expect(
      screen.getByText("This faction no longer exists in the current galaxy."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SystemPanel / FactionPanel — no Suspense/loading fallback ever mounts on a panel open", () => {
  it("a live system's Overview tab renders straight to content, with no role=\"status\" at any point", () => {
    seedSlices({ universe: UNIVERSE });
    renderAt("/system/sys-a");

    // The panel's real title, not a spinner — proves the synchronous store read never routed
    // through a Suspense boundary on the way here.
    expect(screen.getByRole("heading", { name: "Sunnyvale" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a live faction's Overview tab renders straight to content, with no role=\"status\" at any point", () => {
    seedSlices({ factionDetail: { "fac-a": FACTION_DETAIL } });
    renderAt("/factions/fac-a");

    expect(screen.getByRole("heading", { level: 2, name: "The Combine" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SystemPanel / FactionPanel — back/forward across panels restores content", () => {
  it("navigating system -> faction -> back -> forward restores each panel's own title", async () => {
    seedSlices({ universe: UNIVERSE, factionDetail: { "fac-a": FACTION_DETAIL } });
    renderAt("/system/sys-a");
    expect(screen.getByRole("heading", { name: "Sunnyvale" })).toBeInTheDocument();

    act(() => {
      window.history.pushState(null, "", "/factions/fac-a");
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "The Combine" })).toBeInTheDocument(),
    );

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sunnyvale" })).toBeInTheDocument(),
    );

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "The Combine" })).toBeInTheDocument(),
    );
  });
});
