/**
 * Proves entries for the system panel's presence gate (frame-architecture spec,
 * "Interest protocol" — "First-paint gate"; "Store and signature consequences"):
 *
 *  1. store-level: the gate holds while a subscribed id's `systemVitals` entry is absent (the
 *     paused-panel acceptance case at jsdom level — pause never runs a tick, so the entry can sit
 *     absent indefinitely) and clears on the frame that adds it.
 *  2. an id not in `universe` renders the not-found state and logs nothing (never reaches the
 *     detail hooks that could warn).
 *  5. once the gate clears, no hook below it can observe its fallback for that id — asserted
 *     against a frame carrying the WHOLE interest bundle (not just `systemVitals`), proving the
 *     atomic-bundle guarantee (Proves 3) end to end.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { seedSlices } from "@/lib/hooks/__tests__/store-fixture";
import { WouterRuntimeProvider } from "@/client/wouter-link";
import { TickProvider } from "@/lib/hooks/use-tick-context";
import { SystemPanel } from "@/components/panels/system-panel";
import type { UniverseData } from "@/lib/types/game";
import type { SystemVitalsData, SystemSubstrateData } from "@/lib/types/api";
import type { ResourceVector } from "@/lib/types/game";

const ZERO_RESOURCES: ResourceVector = {
  gas: 0,
  minerals: 0,
  ore: 0,
  biomass: 0,
  arable: 0,
  water: 0,
  radioactive: 0,
};

beforeEach(() => {
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

const VISIBLE_VITALS: SystemVitalsData = {
  visibility: "visible",
  stability: { pct: 73, unrest: 0.11 },
  development: { points: 12, potential: 20, pct: 60 },
  population: { headcount: 100, composition: { unskilled: 100, technicians: 0, engineers: 0, unemployed: 0 } },
  provision: { assessed: false },
};

const VISIBLE_SUBSTRATE: SystemSubstrateData = {
  visibility: "visible",
  sunClass: "yellow",
  availableSpace: 10,
  habitableSpace: 5,
  bodies: [
    {
      id: "b1",
      bodyType: "barren_rock",
      archetypeName: "Barren Rock",
      habitable: false,
      size: 1,
      slots: ZERO_RESOURCES,
      quality: ZERO_RESOURCES,
    },
  ],
};

function renderPanel(systemId: string) {
  return render(
    <WouterRuntimeProvider>
      <TickProvider>
        <SystemPanel systemId={systemId} tab="" />
      </TickProvider>
    </WouterRuntimeProvider>,
  );
}

describe("SystemPanel presence gate — subscribed id, entry not yet landed (Proves 1)", () => {
  it("holds the panel shell without the tab body while systemVitals is absent, clears on the frame that adds it", () => {
    seedSlices({ universe: UNIVERSE });
    window.history.pushState(null, "", "/system/sys-a");
    renderPanel("sys-a");

    // Panel shell (title) is up immediately — existence was already proven via `universe`.
    expect(screen.getByRole("heading", { name: "Sunnyvale" })).toBeInTheDocument();
    // But no tab body: SystemOverview unconditionally renders a "Government" context row the
    // instant it mounts, so its absence here proves the tab body never mounted at all — this is
    // the paused-panel case: no tick will ever run to produce a frame on its own.
    expect(screen.queryByText("Government")).not.toBeInTheDocument();

    act(() => {
      seedSlices({ systemVitals: { "sys-a": VISIBLE_VITALS } });
    });

    expect(screen.getByText("Government")).toBeInTheDocument();
  });
});

describe("SystemPanel presence gate — nonexistent id (Proves 2)", () => {
  it("renders the not-found state and logs nothing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedSlices({ universe: UNIVERSE });
    window.history.pushState(null, "", "/system/ghost-system");
    renderPanel("ghost-system");

    expect(
      screen.getByText("This system no longer exists in the current galaxy."),
    ).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("SystemPanel presence gate — cleared with the full interest bundle (Proves 5)", () => {
  it("shows real data for every family in the bundle, never a NOT_FOUND fallback, once the gate clears", () => {
    seedSlices({
      universe: UNIVERSE,
      systemVitals: { "sys-a": VISIBLE_VITALS },
      systemSubstrate: { "sys-a": VISIBLE_SUBSTRATE },
    });
    window.history.pushState(null, "", "/system/sys-a");
    const { container } = renderPanel("sys-a");

    // Vitals: the seeded stability value, not the "isn't developed yet" placeholder a fallback
    // `{ visibility: "unknown" }` would have shown.
    expect(screen.getByText("Stability")).toBeInTheDocument();
    expect(container.textContent).toContain("73");
    expect(
      screen.queryByText("This system isn't developed yet — no vitals to show."),
    ).not.toBeInTheDocument();

    // Substrate: a sibling family in the same atomic bundle — its own real reading is visible too
    // (spread across sibling text nodes next to the star glyph, hence a container-text assertion
    // rather than `getByText`), not the em-dash a `{ visibility: "unknown" }` fallback would render.
    expect(container.textContent).toContain("1 bodies");
  });
});
