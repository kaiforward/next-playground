import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrackerPanel } from "@/components/tracker/tracker-panel";
import { TrackerRow, type TrackerFigure } from "@/components/tracker/tracker-row";
import type { AtlasData } from "@/lib/types/game";
import type { TrackerBuildRow, TrackerData, TrackerPinnedRow } from "@/lib/types/api";
import { DEFAULT_TRACKER_SECTIONS, type TrackerSections } from "@/lib/hooks/use-tracker-sections";

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

/** A whole `TrackerData` from just the sections a test cares about — the rest read empty.
 *  `pinnedSystemIds` mirrors `pinned` unless overridden: the two diverge only for a pin whose
 *  system reads no vitals, which is `PinToggle`'s concern (see pin-toggle.test.tsx), not the
 *  panel's — the panel renders `pinned` and never looks at the id list. */
function tracker(fields: Partial<TrackerData> = {}): TrackerData {
  const pinned = fields.pinned ?? [];
  return {
    pinnedSystemIds: pinned.map((row) => row.systemId),
    pinned: [],
    building: [],
    waitingCount: 0,
    colonising: [],
    ...fields,
  };
}

function pinnedRow(systemId: string, systemName: string): TrackerPinnedRow {
  return {
    systemId,
    systemName,
    population: 2, // formatPeople(2) -> "2M", deterministic
    populationPct: 40,
    stabilityPct: 82,
    unrest: 0.18,
    provisionPct: 90,
    developmentPct: 55,
  };
}

/** `progress` is a fraction in [0,1] — `TrackerRowProps.progress`'s documented units, and what the
 *  service actually sends. A percent-scale number here clamps to 0 in `projectedWidthPct`, so any
 *  forecast assertion built on one would pass vacuously. */
function buildRow(
  systemId: string,
  systemName: string,
  progress: number,
  projectId: string = `proj-${systemId}`,
): TrackerBuildRow {
  return {
    projectId,
    systemId,
    systemName,
    label: "Shipyard L2",
    progress,
    nextCycleProgress: 0.05,
    etaCycles: 4,
  };
}

beforeEach(() => {
  push.mockClear();
  setPinMutate.mockClear();
  trackerData = tracker();
});

/** Renders `TrackerPanel` with all sections on and settings closed, unless a test overrides
 *  `sections` — the shared default so section-visibility tests aren't the only ones spelling
 *  out all three props. */
function renderPanel(sections: TrackerSections = DEFAULT_TRACKER_SECTIONS) {
  return render(<TrackerPanel sections={sections} settingsOpen={false} onToggleSettings={vi.fn()} />);
}

describe("TrackerPanel — hiding a section removes its heading, not just its rows", () => {
  it("Building off: no 'Building — N' heading and no build row, while Pinned and Colonising still render", () => {
    trackerData = tracker({
      pinned: [pinnedRow("sys-a", "Sunnyvale")],
      building: [buildRow("sys-b", "Rigel Yards", 0.5)],
      waitingCount: 4,
    });
    renderPanel({ pinned: true, building: false, colonising: true });

    // The row is gone.
    expect(screen.queryByRole("button", { name: /Rigel Yards/ })).not.toBeInTheDocument();
    // The heading — and the count baked into its text — is gone too, not left behind empty.
    expect(screen.queryByText(/Building/)).not.toBeInTheDocument();
    // The waiting-count line belongs to the hidden section and disappears with it.
    expect(screen.queryByText(/waiting on the pool/)).not.toBeInTheDocument();
    // The other two sections are untouched by Building's removal.
    expect(screen.getByText("Pinned — 1")).toBeInTheDocument();
    expect(screen.getByText("Colonising — 0")).toBeInTheDocument();
  });
});

describe("TrackerPanel — hiding every section leaves the header present", () => {
  it("all three sections off: no section heading renders, but the title and settings toggle still do", () => {
    trackerData = tracker({
      pinned: [pinnedRow("sys-a", "Sunnyvale")],
      building: [buildRow("sys-b", "Rigel Yards", 0.5)],
      waitingCount: 2,
    });
    renderPanel({ pinned: false, building: false, colonising: false });

    expect(screen.queryByText(/Pinned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Building/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Colonising/)).not.toBeInTheDocument();
    // The header — title and the settings toggle that reaches the very checkboxes that just
    // hid everything — is still reachable, not collapsed away along with the sections.
    expect(screen.getByText("Tracker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tracker settings" })).toBeInTheDocument();
  });
});

describe("TrackerPanel — row activation routes by kind, not to one shared path", () => {
  it("a build row opens Industry; a pinned row opens Overview — different destinations, proven by one push each", async () => {
    const user = userEvent.setup();
    trackerData = tracker({
      pinned: [pinnedRow("sys-a", "Sunnyvale")],
      building: [buildRow("sys-b", "Rigel Yards", 0.5)],
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: /Sunnyvale/ }));
    expect(push).toHaveBeenLastCalledWith("/system/sys-a?focus=10,20&loc=1");

    await user.click(screen.getByRole("button", { name: /Rigel Yards/ }));
    expect(push).toHaveBeenLastCalledWith("/system/sys-b/industry?focus=30,40&loc=2");
  });
});

describe("TrackerPanel — the locate nonce advances on every activation", () => {
  it("locating the same system twice produces two different `loc` values", async () => {
    const user = userEvent.setup();
    trackerData = tracker({ pinned: [pinnedRow("sys-a", "Sunnyvale")] });
    renderPanel();

    const row = screen.getByRole("button", { name: /Sunnyvale/ });
    await user.click(row);
    await user.click(row);

    expect(push).toHaveBeenNthCalledWith(1, "/system/sys-a?focus=10,20&loc=1");
    expect(push).toHaveBeenNthCalledWith(2, "/system/sys-a?focus=10,20&loc=2");
  });
});

describe("TrackerPanel — an empty section renders its empty state, not a bare heading", () => {
  it("all three sections empty: each heading is present AND each carries its empty-state message", () => {
    renderPanel(); // trackerData is tracker() — every section empty — from beforeEach

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
    trackerData = tracker({
      building: [buildRow("sys-b", "Rigel Yards", 0.3)],
      waitingCount: 37,
    });
    renderPanel();
    expect(screen.getByText("37 more waiting on the pool")).toBeInTheDocument();
  });

  it("renders no waiting line at all when nothing is behind the front — never '0 more'", () => {
    trackerData = tracker({
      building: [buildRow("sys-b", "Rigel Yards", 0.3)],
    });
    renderPanel();
    expect(screen.queryByText(/more waiting on the pool/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 more/)).not.toBeInTheDocument();
  });

  it("still renders the waiting line when NOTHING is funded — the case where it matters most", () => {
    // The pool wholly absorbed by colonies, or no pool at all: the front is empty and every open
    // build is waiting. The section shows its empty state, and the count of what is behind the
    // front is at its maximum — the two must not be alternatives, or the number vanishes exactly
    // when it is the only thing left to say.
    trackerData = tracker({ building: [], waitingCount: 12 });
    renderPanel();

    expect(screen.getByText("Building — 0")).toBeInTheDocument();
    expect(screen.getByText("Nothing funded this cycle.")).toBeInTheDocument();
    expect(screen.getByText("12 more waiting on the pool")).toBeInTheDocument();
  });
});

describe("TrackerPanel — a pinned row's card carries the figures the row has no room for", () => {
  /** Opens the first row's rich card by keyboard (Tab past the header's settings toggle onto the
   *  row, which opens on focus) and returns the card's content region. Hover would work too; the
   *  keyboard path is the one the spec requires to exist. */
  async function openFirstRowCard(user: ReturnType<typeof userEvent.setup>) {
    await user.tab(); // header settings toggle
    await user.tab(); // the row
    return screen.findByText("Sunnyvale", { selector: "h3" });
  }

  it("shows population against its cap — the crowding read the row deliberately omits", async () => {
    const user = userEvent.setup();
    trackerData = tracker({ pinned: [pinnedRow("sys-a", "Sunnyvale")] });
    renderPanel();

    await openFirstRowCard(user);

    // The row itself carries only two figures (population, stability); the ratio lives here.
    expect(screen.getByText("Of capacity")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("renders an em-dash for a system the economy has never assessed, not '0%'", async () => {
    const user = userEvent.setup();
    trackerData = tracker({
      pinned: [{ ...pinnedRow("sys-a", "Sunnyvale"), provisionPct: null }],
    });
    renderPanel();

    await openFirstRowCard(user);

    const provisioned = screen.getByText("Provisioned").closest("div");
    expect(provisioned).toHaveTextContent("—");
    expect(provisioned).not.toHaveTextContent("0%");
  });
});

describe("TrackerPanel — the Building section caps at 10 rows, keeping queue order", () => {
  function manyBuildRows(n: number): TrackerBuildRow[] {
    return Array.from({ length: n }, (_, i) => buildRow(`sys-${i}`, `System ${i}`, 0.1));
  }

  it("renders exactly 10 rows and states how many more are funded when there are more than 10", () => {
    trackerData = tracker({ building: manyBuildRows(13), waitingCount: 5 });
    renderPanel();

    expect(screen.getAllByRole("button", { name: /Shipyard L2/ })).toHaveLength(10);
    // The two counts stay distinct: 3 funded-but-hidden by the cap, 5 not funded at all.
    expect(screen.getByText("3 more funded this cycle, not shown")).toBeInTheDocument();
    expect(screen.getByText("5 more waiting on the pool")).toBeInTheDocument();
  });

  it("renders no 'more funded' phrasing at all when 10 or fewer rows are funded", () => {
    trackerData = tracker({ building: manyBuildRows(10) });
    renderPanel();

    expect(screen.getAllByRole("button", { name: /Shipyard L2/ })).toHaveLength(10);
    expect(screen.queryByText(/more funded/)).not.toBeInTheDocument();
  });

  it("keeps queue order when capping — the first 10 of the array, not re-sorted by name or progress", () => {
    // Deliberately scrambled relative to both id/name order and progress order, so a cap that
    // sorted (by name, by id, or by progress, ascending or descending) would reorder this and the
    // omitted 11th row would not be the one actually last in the queue.
    const rows: TrackerBuildRow[] = [
      buildRow("sys-f", "Fyords", 0.4),
      buildRow("sys-b", "Bexley", 0.9),
      buildRow("sys-j", "Jonestown", 0.1),
      buildRow("sys-a", "Aurora", 0.6),
      buildRow("sys-h", "Halcyon", 0.2),
      buildRow("sys-c", "Cordoba", 0.75),
      buildRow("sys-k", "Kepler", 0.05),
      buildRow("sys-d", "Delta", 0.55),
      buildRow("sys-i", "Ionia", 0.33),
      buildRow("sys-e", "Echo", 0.8),
      buildRow("sys-g", "Gamma", 0.15), // 11th — must be the one omitted
    ];
    trackerData = tracker({ building: rows });
    renderPanel();

    const renderedIds = Array.from(document.querySelectorAll("[data-system-id]")).map((el) =>
      el.getAttribute("data-system-id"),
    );
    expect(renderedIds).toEqual(rows.slice(0, 10).map((r) => r.systemId));
  });
});

describe("TrackerPanel — a system with several concurrent build projects renders each as its own row", () => {
  it("two funded builds at the SAME system both render, with their distinct labels", () => {
    // The fixture shape the old tests never had: distinct projectIds, same systemId. A single
    // system routinely runs several concurrent build projects (housing, an extractor, an academy —
    // the planner bundles gate-first), so systemId alone can't tell these two rows apart.
    trackerData = tracker({
      building: [
        { projectId: "p1", systemId: "sys-a", systemName: "Sunnyvale", label: "Housing x2", progress: 0.10, nextCycleProgress: 0.05, etaCycles: 3 },
        { projectId: "p2", systemId: "sys-a", systemName: "Sunnyvale", label: "Foundry x1", progress: 0.20, nextCycleProgress: 0.05, etaCycles: 5 },
      ],
    });
    const { rerender } = renderPanel();

    expect(screen.getByRole("button", { name: /Sunnyvale · Housing x2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sunnyvale · Foundry x1/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Sunnyvale/ })).toHaveLength(2);

    // React tolerates a duplicate key fine on a first mount (it only warns) — the corruption is a
    // RECONCILIATION defect, so the real proof is that both rows survive a re-render untouched. Swap
    // in a third, unrelated project ahead of them (mirrors the front reordering as new work is
    // funded) and confirm neither same-system row is dropped, duplicated, or bleeds the other's data.
    trackerData = tracker({
      building: [
        { projectId: "p3", systemId: "sys-c", systemName: "Rigel", label: "Yard x1", progress: 0.05, nextCycleProgress: 0.05, etaCycles: 9 },
        { projectId: "p1", systemId: "sys-a", systemName: "Sunnyvale", label: "Housing x2", progress: 0.15, nextCycleProgress: 0.05, etaCycles: 2 },
        { projectId: "p2", systemId: "sys-a", systemName: "Sunnyvale", label: "Foundry x1", progress: 0.25, nextCycleProgress: 0.05, etaCycles: 4 },
      ],
    });
    rerender(<TrackerPanel sections={DEFAULT_TRACKER_SECTIONS} settingsOpen={false} onToggleSettings={vi.fn()} />);

    expect(screen.getByText("Building — 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sunnyvale · Housing x2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sunnyvale · Foundry x1/ })).toBeInTheDocument();
    // Excludes the header's settings toggle, which is also a `button` but not a row.
    expect(screen.getAllByRole("button", { name: (name) => name !== "Tracker settings" })).toHaveLength(3);
  });
});

describe("TrackerPanel — re-rendering with fresh data replaces rows, never accumulates them", () => {
  it("a tick's worth of new building data renders exactly the new row count, not the sum of old and new", () => {
    // Reproduces the owner's report directly: the Tracker query is invalidated every economy cycle,
    // so a systemId key (repeated across the SAME system's several projects) left stale rows behind
    // on every re-render instead of replacing them — 46 DOM nodes for a 22-row, 10-capped list.
    trackerData = tracker({
      building: [
        { projectId: "p1", systemId: "sys-a", systemName: "Sunnyvale", label: "Housing x2", progress: 0.10, nextCycleProgress: 0.05, etaCycles: 3 },
        { projectId: "p2", systemId: "sys-a", systemName: "Sunnyvale", label: "Foundry x1", progress: 0.20, nextCycleProgress: 0.05, etaCycles: 5 },
      ],
    });
    const { rerender } = renderPanel();
    expect(screen.getAllByRole("button", { name: /Sunnyvale/ })).toHaveLength(2);

    // Next cycle: "p1" (Housing) finished and dropped off the front; a new project "p3" (Yard, a
    // different system) took its place at the front of the queue, and "p2" (Foundry) is still
    // running. Same systemId repeated in the OLD list, and the front's order shifted — exactly the
    // shape that makes React's key-based reconciliation lose track of which fiber is which.
    trackerData = tracker({
      building: [
        { projectId: "p3", systemId: "sys-c", systemName: "Rigel", label: "Yard x1", progress: 0.05, nextCycleProgress: 0.05, etaCycles: 8 },
        { projectId: "p2", systemId: "sys-a", systemName: "Sunnyvale", label: "Foundry x1", progress: 0.45, nextCycleProgress: 0.05, etaCycles: 3 },
      ],
    });
    rerender(<TrackerPanel sections={DEFAULT_TRACKER_SECTIONS} settingsOpen={false} onToggleSettings={vi.fn()} />);

    expect(screen.getByText("Building — 2")).toBeInTheDocument();
    // The total rendered row count must match the NEW list (2), not the sum of old + new (4), and
    // the completed project's row must actually be gone, not left behind as a stale duplicate.
    // Excludes the header's settings toggle, which is also a `button` but not a row.
    expect(screen.getAllByRole("button", { name: (name) => name !== "Tracker settings" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Rigel · Yard x1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sunnyvale · Foundry x1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Housing x2/ })).not.toBeInTheDocument();
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
    // width maths lives in `progressWidthPct`, tested in node.
    expect(fill).not.toBeNull();
  });
});

describe("TrackerRow — the coming cycle's gain is drawn only when there is one", () => {
  /** The track's segments. Existence and count only — the carve-out the component-test convention
   *  allows, since jsdom can't verify a width. The widths are pinned in `math.test.ts`. */
  function segmentsOf(container: HTMLElement): Element[] {
    const track = container.querySelector(".bg-surface-active");
    expect(track).not.toBeNull();
    return Array.from(track?.querySelectorAll("span") ?? []);
  }

  it("a funded row draws the forecast segment alongside its fill", () => {
    const { container } = render(
      <TrackerRow
        systemId="sys-a"
        name="Rigel Yards"
        figures={[]}
        progress={0.4}
        nextCycleProgress={0.2}
        tone="build"
        onActivate={vi.fn()}
        card={<div>card</div>}
      />,
    );
    expect(segmentsOf(container)).toHaveLength(2);
  });

  it("a row absorbing nothing next cycle draws its fill alone — no empty forecast element", () => {
    const { container } = render(
      <TrackerRow
        systemId="sys-a"
        name="Starved Colony"
        figures={[]}
        progress={0.4}
        nextCycleProgress={0}
        tone="colony"
        onActivate={vi.fn()}
        card={<div>card</div>}
      />,
    );
    expect(segmentsOf(container)).toHaveLength(1);
  });

  it("a completed bar has no room left, so nothing is drawn ahead of it", () => {
    const { container } = render(
      <TrackerRow
        systemId="sys-a"
        name="Finishing Yards"
        figures={[]}
        progress={1}
        nextCycleProgress={0.3}
        tone="build"
        onActivate={vi.fn()}
        card={<div>card</div>}
      />,
    );
    expect(segmentsOf(container)).toHaveLength(1);
  });
});

describe("TrackerPanel — a build or colony row shows its cycles remaining on the row itself", () => {
  it("a funded build reads its ETA on the row; a colony with no forecast reads an em-dash, not a stale number", () => {
    trackerData = tracker({
      building: [buildRow("sys-b", "Rigel Yards", 0.5)], // etaCycles 4
      colonising: [
        {
          systemId: "sys-a",
          systemName: "New Haven",
          label: "Establish Colony",
          progress: 0.3,
          nextCycleProgress: 0,
          etaCycles: null,
        },
      ],
    });
    renderPanel();

    // Read off the row's accessible name rather than a standalone text query: that is what proves
    // the figure rendered inside the row it describes, and it carries the sr-only label with it.
    expect(
      screen.getByRole("button", {
        name: (name) => name.includes("Rigel Yards") && name.includes("≈4 cyc"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: (name) => name.includes("New Haven") && name.includes("Cycles remaining") && name.includes("—"),
      }),
    ).toBeInTheDocument();
    // The unforecastable colony must not borrow the funded build's number.
    expect(
      screen.queryByRole("button", { name: (name) => name.includes("New Haven") && name.includes("4") }),
    ).not.toBeInTheDocument();
  });
});

describe("TrackerPanel — a project row's card ETA matches the row's own coarse register", () => {
  it("reads the same ≈-prefixed value as the row, never a falsely precise bare number", async () => {
    const user = userEvent.setup();
    trackerData = tracker({ building: [buildRow("sys-b", "Rigel Yards", 0.5)] }); // etaCycles 4
    renderPanel();

    await user.tab(); // header settings toggle
    await user.tab(); // the row (Pinned and Colonising are empty — nothing else tabbable ahead of it)
    await screen.findByText("Rigel Yards", { selector: "h3" });

    // Scoped to the card's own ETA line — the row's OWN figure carries the identical text
    // ("≈4 cyc"), so an unscoped text query would match both and fail on ambiguity.
    const eta = screen.getByText("ETA").closest("div");
    expect(eta).toHaveTextContent("≈4 cyc");
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
