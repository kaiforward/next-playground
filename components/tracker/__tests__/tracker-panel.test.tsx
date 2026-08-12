import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerPanel } from "@/components/tracker/tracker-panel";
import { TrackerRow, type TrackerFigure } from "@/components/tracker/tracker-row";
import type { AtlasData } from "@/lib/types/game";
import type { TrackerBuildRow, TrackerData, TrackerPinnedRow } from "@/lib/types/api";

// TrackerPanel owns three suspense-backed hooks (useTracker, useAtlas) and a mutation
// (useSetSystemPin). All three are mocked directly rather than through a real QueryClient —
// QueryBoundary's Suspense/ErrorBoundary/QueryErrorResetBoundary machinery needs no QueryClient
// context of its own (only useSuspenseQuery does, and that call never runs here), so mocking the
// hooks is both simpler and keeps these tests about the panel's own logic, not TanStack's.

const push = vi.fn();
const setPinMutate = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-player-pins", () => ({
  useSetSystemPin: () => ({ mutate: setPinMutate }),
}));

const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 2, seed: 1 },
  regions: [],
  systems: [
    {
      id: "sys-a",
      x: 10,
      y: 20,
      regionId: "r1",
      factionId: "f1",
      economyType: "agricultural",
      isGateway: false,
      developed: true,
      sunClass: "yellow",
    },
    {
      id: "sys-b",
      x: 30,
      y: 40,
      regionId: "r1",
      factionId: "f1",
      economyType: "industrial",
      isGateway: false,
      developed: true,
      sunClass: "yellow",
    },
  ],
  connections: [],
  factions: [],
  player: null,
};

vi.mock("@/lib/hooks/use-atlas", () => ({
  useAtlas: () => ({ atlas: ATLAS }),
}));

let trackerData: TrackerData;
vi.mock("@/lib/hooks/use-tracker", () => ({
  useTracker: () => trackerData,
}));

function emptyTracker(): TrackerData {
  return { pinned: [], building: [], waitingCount: 0, colonising: [] };
}

function pinnedRow(systemId: string, systemName: string): TrackerPinnedRow {
  return {
    systemId,
    systemName,
    population: 2, // formatPeople(2) -> "2M", deterministic
    populationPct: 40,
    stabilityPct: 82,
    provisionPct: 90,
    developmentPct: 55,
  };
}

function buildRow(systemId: string, systemName: string, progress: number): TrackerBuildRow {
  return { systemId, systemName, label: "Shipyard L2", progress, etaCycles: 4 };
}

beforeEach(() => {
  push.mockClear();
  setPinMutate.mockClear();
  trackerData = emptyTracker();
});

describe("TrackerPanel — row activation routes by kind, not to one shared path", () => {
  it("a build row opens Industry; a pinned row opens Overview — different destinations, proven by one push each", async () => {
    const user = userEvent.setup();
    trackerData = {
      pinned: [pinnedRow("sys-a", "Sunnyvale")],
      building: [buildRow("sys-b", "Rigel Yards", 50)],
      waitingCount: 0,
      colonising: [],
    };
    render(<TrackerPanel />);

    await user.click(screen.getByRole("button", { name: /Sunnyvale/ }));
    expect(push).toHaveBeenLastCalledWith("/system/sys-a?focus=10,20&loc=1");

    await user.click(screen.getByRole("button", { name: /Rigel Yards/ }));
    expect(push).toHaveBeenLastCalledWith("/system/sys-b/industry?focus=30,40&loc=2");
  });
});

describe("TrackerPanel — the locate nonce advances on every activation", () => {
  it("locating the same system twice produces two different `loc` values", async () => {
    const user = userEvent.setup();
    trackerData = { pinned: [pinnedRow("sys-a", "Sunnyvale")], building: [], waitingCount: 0, colonising: [] };
    render(<TrackerPanel />);

    const row = screen.getByRole("button", { name: /Sunnyvale/ });
    await user.click(row);
    await user.click(row);

    expect(push).toHaveBeenNthCalledWith(1, "/system/sys-a?focus=10,20&loc=1");
    expect(push).toHaveBeenNthCalledWith(2, "/system/sys-a?focus=10,20&loc=2");
  });
});

describe("TrackerPanel — an empty section renders its empty state, not a bare heading", () => {
  it("all three sections empty: each heading is present AND each carries its empty-state message", () => {
    render(<TrackerPanel />); // trackerData is emptyTracker() from beforeEach

    expect(screen.getByText("Pinned — 0")).toBeInTheDocument();
    expect(screen.getByText("No pinned systems yet.")).toBeInTheDocument();
    expect(screen.getByText("Building — 0")).toBeInTheDocument();
    expect(screen.getByText("Nothing funded this cycle.")).toBeInTheDocument();
    expect(screen.getByText("Colonising — 0")).toBeInTheDocument();
    expect(screen.getByText("No colonies forming.")).toBeInTheDocument();
  });
});

describe("TrackerPanel — the waiting count is a quiet line, present only when nonzero", () => {
  it("renders the count when projects sit behind the front", () => {
    trackerData = {
      pinned: [],
      building: [buildRow("sys-b", "Rigel Yards", 30)],
      waitingCount: 37,
      colonising: [],
    };
    render(<TrackerPanel />);
    expect(screen.getByText("37 more waiting on the pool")).toBeInTheDocument();
  });

  it("renders no waiting line at all when nothing is behind the front — never '0 more'", () => {
    trackerData = {
      pinned: [],
      building: [buildRow("sys-b", "Rigel Yards", 30)],
      waitingCount: 0,
      colonising: [],
    };
    render(<TrackerPanel />);
    expect(screen.queryByText(/more waiting on the pool/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 more/)).not.toBeInTheDocument();
  });
});

describe("TrackerRow — a zero-progress row still shows its track", () => {
  it("progress 0 renders the track and its fill element, not nothing", () => {
    const { container } = render(
      <TrackerRow
        systemId="sys-a"
        name="Stalled Yards"
        figures={[]}
        progress={0}
        tone="build"
        onActivate={vi.fn()}
        card={<div>card</div>}
      />,
    );
    const track = container.querySelector(".bg-surface-active");
    expect(track).not.toBeNull();
    const fill = track?.querySelector("span");
    // Existence only, which is the whole claim: a falsy `progress &&` guard would render neither
    // element at progress 0. The fill's WIDTH is deliberately not asserted — jsdom has no layout
    // engine, so a width assertion would prove only that a string reached a style attribute. The
    // width maths lives in `clamp`, tested in node.
    expect(fill).not.toBeNull();
  });
});

describe("TrackerRow — a pinned row's accessible name is built from what actually rendered", () => {
  it("the row's name includes population and stability, sourced from real DOM text nodes", () => {
    const figures: TrackerFigure[] = [
      { icon: <span>icon</span>, label: "Population", value: "2M" },
      { label: "Stability", value: "82%", swatchColor: "#22c55e" },
    ];
    render(
      <TrackerRow
        systemId="sys-a"
        name="Sunnyvale"
        figures={figures}
        onActivate={vi.fn()}
        card={<div>card</div>}
      />,
    );

    const row = screen.getByRole("button", {
      name: (accessibleName) =>
        accessibleName.includes("Sunnyvale") &&
        accessibleName.includes("Population") &&
        accessibleName.includes("2M") &&
        accessibleName.includes("Stability") &&
        accessibleName.includes("82%"),
    });
    expect(row).toBeInTheDocument();
  });
});
