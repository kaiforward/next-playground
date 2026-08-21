/**
 * Review finding (2026-08-20, Task 9 review): before the worker's first state frame lands,
 * `worldVersion` is null and every store-backed hook (`useSystemInfo`, `useFaction`) reads its
 * slice's empty default — indistinguishable, at the panel root, from a genuinely absent id. Without
 * a pre-boot guard, opening a panel URL for an entity that simply hasn't loaded YET would flash the
 * not-found `EmptyState` instead of nothing. `system-panel.tsx`/`faction-panel.tsx` guard on
 * `worldVersion !== null` and render `null` pre-boot.
 *
 * Isolated into its own file, each test resetting modules and dynamically re-importing the
 * `gameStore` singleton (`lib/store/use-game-store.ts`) fresh: `panel-routing.test.tsx` shares ONE
 * `gameStore` instance across its whole file (`store-fixture.ts`'s own documented constraint), so
 * once any test there seeds a frame, `worldVersion` stays non-null for the rest of that file — no
 * genuine "pre-boot" moment survives past its first seed. A fresh module registry per test here is
 * what makes `worldVersion === null` observable at all, for both `SystemPanel` and `FactionPanel`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { UniverseData } from "@/lib/types/game";
import type { FactionDetail } from "@/lib/services/factions";

beforeEach(() => {
  vi.resetModules();
  Element.prototype.scrollTo = vi.fn();
});

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

/** Fresh copies of every module in the render path that (transitively) touches the `gameStore`
 *  singleton — imported dynamically, after `vi.resetModules()`, so this test's `SystemPanel`/
 *  `FactionPanel` close over a brand-new, unseeded store rather than one another test already
 *  seeded. */
async function freshModules() {
  const [{ SystemPanel }, { FactionPanel }, { gameStore }, { WouterRuntimeProvider }, { TickProvider }] =
    await Promise.all([
      import("@/components/panels/system-panel"),
      import("@/components/panels/faction-panel"),
      import("@/lib/store/use-game-store"),
      import("@/client/wouter-link"),
      import("@/lib/hooks/use-tick-context"),
    ]);
  return { SystemPanel, FactionPanel, gameStore, WouterRuntimeProvider, TickProvider };
}

describe("SystemPanel — pre-boot render (no state frame applied yet)", () => {
  it("renders nothing for a live system id before the first frame lands, then its content once booted", async () => {
    const { SystemPanel, gameStore, WouterRuntimeProvider, TickProvider } = await freshModules();
    window.history.pushState(null, "", "/system/sys-a");

    render(
      <WouterRuntimeProvider>
        <TickProvider>
          <SystemPanel systemId="sys-a" tab="" />
        </TickProvider>
      </WouterRuntimeProvider>,
    );

    // Pre-boot: neither the not-found EmptyState nor any panel content — nothing at all, and
    // definitely no role="status" (Proves 2 must hold pre-boot too).
    expect(
      screen.queryByText("This system no longer exists in the current galaxy."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      gameStore.applyStateFrame({ frameSeq: 1, worldVersion: 1, slices: { universe: UNIVERSE } });
    });

    expect(screen.getByRole("heading", { name: "Sunnyvale" })).toBeInTheDocument();
  });
});

describe("FactionPanel — pre-boot render (no state frame applied yet)", () => {
  it("renders nothing for a live faction id before the first frame lands, then its content once booted", async () => {
    const { FactionPanel, gameStore, WouterRuntimeProvider, TickProvider } = await freshModules();
    window.history.pushState(null, "", "/factions/fac-a");

    render(
      <WouterRuntimeProvider>
        <TickProvider>
          <FactionPanel factionId="fac-a" tab="" />
        </TickProvider>
      </WouterRuntimeProvider>,
    );

    expect(
      screen.queryByText("This faction no longer exists in the current galaxy."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      gameStore.applyStateFrame({ frameSeq: 1,
        worldVersion: 1,
        slices: { factionDetail: { "fac-a": FACTION_DETAIL } },
      });
    });

    expect(screen.getByRole("heading", { level: 2, name: "The Combine" })).toBeInTheDocument();
  });
});
