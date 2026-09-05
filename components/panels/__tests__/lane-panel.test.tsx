import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanePanel, laneInvestState } from "@/components/panels/lane-panel";
import { gameStore } from "@/lib/store/use-game-store";
import { WouterRuntimeProvider } from "@/client/wouter-link";
import type { UniverseData, AtlasData } from "@/lib/types/game";
import type { LaneDetailData } from "@/lib/types/api";
import { MAX_ORDER_LEVELS } from "@/lib/schemas/construction-orders";

// The order verbs run through the real hooks (`use-construction-orders.ts`) down to this one seam,
// so a rejected command travels the path it really travels — `sendCommand` → `CommandResult` →
// `useCommandMutation`'s onError — rather than through a stubbed mutation object.
const commandResult = vi.hoisted(() => ({
  current: { ok: true, data: { projectId: "p-1" } } as
    | { ok: true; data: { projectId: string } }
    | { ok: false; error: string },
}));
vi.mock("@/lib/runtime/command-client", () => ({
  sendCommand: (envelope: { id: string }) =>
    Promise.resolve({ type: "commandResult", id: envelope.id, result: commandResult.current }),
}));

const UNIVERSE: UniverseData = {
  regions: [],
  systems: [
    {
      id: "sys-a", name: "Sunnyvale", economyType: "agricultural", x: 0, y: 0,
      description: "", regionId: "", factionId: "f-player", isGateway: false, developed: true, sunClass: "yellow",
    },
    {
      id: "sys-b", name: "Marrow", economyType: "extraction", x: 10, y: 10,
      description: "", regionId: "", factionId: null, isGateway: false, developed: true, sunClass: "yellow",
    },
  ],
  connections: [],
  factions: [
    { id: "f-player", name: "Meridian Combine", color: "#fff", governmentType: null },
    { id: "f-rival", name: "Verdant Compact", color: "#000", governmentType: null },
  ],
};

const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 2, seed: 1 },
  regions: [],
  systems: [],
  connections: [],
  factions: [],
  player: { controlledFactionId: "f-player", homeworldSystemId: "sys-a" },
};

function laneDetailFixture(overrides: Partial<LaneDetailData> = {}): LaneDetailData {
  return {
    key: "sys-a|sys-b",
    fuelCost: 8.6,
    a: { systemId: "sys-a", systemName: "Sunnyvale", factionId: "f-player", unclaimed: false },
    b: { systemId: "sys-b", systemName: "Marrow", factionId: null, unclaimed: true },
    level: 2,
    capacity: 30,
    bookedLoad: 24,
    blockedVolume: 0,
    inFlight: 0,
    idleCycles: 0,
    investorFactionId: null,
    cargo: [],
    openProjects: [],
    ...overrides,
  };
}

function investableLane() {
  return laneDetailFixture({
    b: { systemId: "sys-b", systemName: "Marrow", factionId: "f-player", unclaimed: false },
    investorFactionId: "f-player",
  });
}

function seed(options: { atlas?: AtlasData; laneDetail?: Record<string, LaneDetailData> } = {}) {
  act(() => {
    gameStore.applyStateFrame({
      frameSeq: Date.now(),
      worldVersion: Date.now(),
      slices: { universe: UNIVERSE, atlas: options.atlas ?? ATLAS, laneDetail: options.laneDetail ?? {} },
    });
  });
}

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  commandResult.current = { ok: true, data: { projectId: "p-1" } };
});

afterEach(() => {
  window.history.pushState(null, "", "/");
});

describe("LanePanel", () => {
  it("titles the panel with both endpoint names once both systems exist", () => {
    seed();
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );
    expect(screen.getByRole("heading", { name: "Sunnyvale — Marrow" })).toBeInTheDocument();
  });

  it("shows the not-found EmptyState for a malformed lane key", () => {
    seed();
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="not-a-lane-key" />
      </WouterRuntimeProvider>,
    );
    expect(screen.getByText("This lane no longer exists in the current galaxy.")).toBeInTheDocument();
  });

  it("shows the not-found EmptyState when an endpoint system no longer exists", () => {
    seed();
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|ghost" />
      </WouterRuntimeProvider>,
    );
    expect(screen.getByText("This lane no longer exists in the current galaxy.")).toBeInTheDocument();
  });

  it("renders the vitals grid and disables the invest verb, naming the unclaimed endpoint, when the player does not control both ends", () => {
    seed({ laneDetail: { "sys-a|sys-b": laneDetailFixture() } });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );

    expect(screen.getByText("2")).toBeInTheDocument(); // the Level tile's value
    const invest = screen.getByRole("button", { name: /Invest/ });
    expect(invest).toBeDisabled();
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").includes("Marrow is unclaimed")),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "claim Marrow" })).toHaveAttribute("href", "/system/sys-b");
  });

  it("names the foreign faction, not unclaimed, when both ends are claimed but split between two factions", () => {
    seed({
      laneDetail: {
        "sys-a|sys-b": laneDetailFixture({
          b: { systemId: "sys-b", systemName: "Marrow", factionId: "f-rival", unclaimed: false },
        }),
      },
    });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );

    const invest = screen.getByRole("button", { name: /Invest/ });
    expect(invest).toBeDisabled();
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          (el.textContent ?? "") === "Marrow belongs to Verdant Compact. Only the faction holding both ends can invest in a lane.",
      ),
    ).toBeInTheDocument();
  });

  it("enables the invest verb when the player controls both ends", () => {
    seed({
      laneDetail: {
        "sys-a|sys-b": laneDetailFixture({
          b: { systemId: "sys-b", systemName: "Marrow", factionId: "f-player", unclaimed: false },
          investorFactionId: "f-player",
        }),
      },
    });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );

    expect(screen.getByRole("button", { name: /Invest/ })).toBeEnabled();
  });

  it("disables the invest verb past the order ceiling and says why", async () => {
    const user = userEvent.setup();
    seed({ laneDetail: { "sys-a|sys-b": investableLane() } });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );

    const levels = screen.getByRole("spinbutton", { name: "Levels" });
    await user.clear(levels);
    await user.type(levels, String(MAX_ORDER_LEVELS + 1));

    expect(screen.getByRole("button", { name: /Invest/ })).toBeDisabled();
    expect(screen.getByText(new RegExp(`at most ${MAX_ORDER_LEVELS} levels`))).toBeInTheDocument();
  });

  it("shows a rejected order's own reason instead of dropping it silently", async () => {
    const user = userEvent.setup();
    commandResult.current = { ok: false, error: "The construction pool is already committed." };
    seed({ laneDetail: { "sys-a|sys-b": investableLane() } });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Invest/ }));

    expect(await screen.findByText("The construction pool is already committed.")).toBeInTheDocument();
  });

  it("names congestion in the Turned away hint only once volume is actually blocked", () => {
    seed({ laneDetail: { "sys-a|sys-b": laneDetailFixture({ blockedVolume: 6 }) } });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );
    expect(screen.getByText("congested")).toBeInTheDocument();
  });

  it("does not name congestion when nothing was blocked this run", () => {
    seed({ laneDetail: { "sys-a|sys-b": laneDetailFixture({ blockedVolume: 0 }) } });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );
    expect(screen.queryByText("congested")).not.toBeInTheDocument();
  });

  it("labels the per-run booking tile Booked", () => {
    seed({ laneDetail: { "sys-a|sys-b": laneDetailFixture({}) } });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.queryByText("Load")).not.toBeInTheDocument();
  });

  it("renders an empty-state cargo card when nothing is in flight, and a row per ledger entry otherwise", () => {
    seed({
      laneDetail: {
        "sys-a|sys-b": laneDetailFixture({
          cargo: [{
            goodId: "water", goodName: "Water", quantity: 18,
            fromSystemId: "sys-a", fromSystemName: "Sunnyvale", toSystemId: "sys-b", toSystemName: "Marrow",
            arrivalTick: 30,
          }],
        }),
      },
    });
    render(
      <WouterRuntimeProvider>
        <LanePanel laneKey="sys-a|sys-b" />
      </WouterRuntimeProvider>,
    );

    expect(screen.getByText("Cargo in flight")).toBeInTheDocument();
    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sunnyvale" }).length).toBeGreaterThan(0);
  });
});

describe("laneInvestState", () => {
  it("is hidden with no player seat", () => {
    expect(laneInvestState(laneDetailFixture(), null, () => "")).toEqual({ kind: "hidden" });
  });

  it("is hidden when a single other faction already qualifies as investor", () => {
    const state = laneInvestState(
      laneDetailFixture({ investorFactionId: "f-rival" }),
      "f-player",
      () => "Verdant Compact",
    );
    expect(state).toEqual({ kind: "hidden" });
  });

  it("is ready when the viewer's own faction is the investor", () => {
    const state = laneInvestState(laneDetailFixture({ investorFactionId: "f-player" }), "f-player", () => "");
    expect(state).toEqual({ kind: "ready" });
  });
});
