import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LanePanel } from "@/components/panels/lane-panel";
import { gameStore } from "@/lib/store/use-game-store";
import { WouterRuntimeProvider } from "@/client/wouter-link";
import type { UniverseData } from "@/lib/types/game";

const UNIVERSE: UniverseData = {
  regions: [],
  systems: [
    {
      id: "sys-a", name: "Sunnyvale", economyType: "agricultural", x: 0, y: 0,
      description: "", regionId: "", factionId: null, isGateway: false, developed: true, sunClass: "yellow",
    },
    {
      id: "sys-b", name: "Marrow", economyType: "extraction", x: 10, y: 10,
      description: "", regionId: "", factionId: null, isGateway: false, developed: true, sunClass: "yellow",
    },
  ],
  connections: [],
  factions: [],
};

function seed() {
  act(() => {
    gameStore.applyStateFrame({ frameSeq: Date.now(), worldVersion: Date.now(), slices: { universe: UNIVERSE } });
  });
}

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
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
});
