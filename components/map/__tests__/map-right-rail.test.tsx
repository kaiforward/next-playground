import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapRightRail } from "@/components/map/map-right-rail";
import type { AtlasData } from "@/lib/types/game";
import type { TrackerData } from "@/lib/types/api";

// Proves the owner-decision-2 wiring: the settings surface is a SIBLING panel toggled from the
// Tracker's own header (never a popover), and toggling one of its checkboxes actually
// filters TrackerPanel's own sections — which requires `useTrackerSections()` to be a single
// hook instance shared via props, not two independent instances that can't see each other's
// writes. `MapControlsDock` is stubbed out: its own render tree (Pixi colour ramps, tooltips) is
// unrelated to what's under test here.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-player-pins", () => ({
  useSetSystemPin: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/map/map-controls-dock", () => ({
  MapControlsDock: () => <div data-testid="map-controls-dock-stub" />,
}));

const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 0, seed: 1 },
  regions: [],
  systems: [],
  connections: [],
  factions: [],
  player: null,
};

vi.mock("@/lib/hooks/use-atlas", () => ({
  useAtlas: () => ({ atlas: ATLAS }),
}));

function emptyTracker(): TrackerData {
  return { pinnedSystemIds: [], pinned: [], building: [], waitingCount: 0, colonising: [] };
}

vi.mock("@/lib/hooks/use-tracker", () => ({
  useTracker: () => emptyTracker(),
}));

beforeEach(() => {
  window.localStorage.clear();
});

// settingsOpen/onToggleSettings are lifted OUT of MapRightRail (finding 4 of the Task 12 review
// round — it used to own this as its own useState and echo it upward). This harness is what a real
// caller (star-map.tsx) looks like now: a single piece of state, passed down and toggled from here,
// so the suite still exercises real open/close behaviour rather than a prop that never changes.
function renderRail() {
  function Harness() {
    const [settingsOpen, setSettingsOpen] = useState(false);
    return (
      <MapRightRail
        mode="political"
        setMode={vi.fn()}
        overlays={{ logistics: false }}
        toggle={vi.fn()}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
      />
    );
  }
  return render(<Harness />);
}

describe("MapRightRail — the settings panel is a sibling, opened and closed from the Tracker's own header", () => {
  it("closed by default: no settings panel, no section checkboxes reachable", () => {
    renderRail();
    expect(screen.queryByRole("group", { name: "Tracker sections" })).not.toBeInTheDocument();
    // The dock is the rail's third sibling, mounted unconditionally alongside the Tracker
    // pair — nothing else in this suite queries for it, so a regression that dropped it from
    // the rail (losing map mode/overlay controls from every map screen) would go unnoticed.
    expect(screen.getByTestId("map-controls-dock-stub")).toBeInTheDocument();
  });

  it("clicking the header's settings toggle mounts the sibling panel with its three checkboxes", async () => {
    const user = userEvent.setup();
    renderRail();

    const toggle = screen.getByRole("button", { name: "Tracker settings" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Tracker sections" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Pinned" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Building" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Colonising" })).toBeChecked();
  });

  it("clicking the toggle again closes the panel — it occupies no space, not just hidden content", async () => {
    const user = userEvent.setup();
    renderRail();
    const toggle = screen.getByRole("button", { name: "Tracker settings" });

    await user.click(toggle);
    expect(screen.getByRole("group", { name: "Tracker sections" })).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", { name: "Tracker sections" })).not.toBeInTheDocument();
  });
});

describe("MapRightRail — a checkbox in the settings panel filters TrackerPanel's own sections live", () => {
  it("unticking Colonising immediately removes the Tracker's Colonising heading, no re-render trigger needed", async () => {
    const user = userEvent.setup();
    renderRail();

    await user.click(screen.getByRole("button", { name: "Tracker settings" }));
    expect(screen.getByText("Colonising — 0")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Colonising" }));

    // The Tracker's own heading is gone (its wording carries the count: "Colonising — N"). The
    // settings panel's own "Colonising" checkbox LABEL is expected to remain — it stays visible
    // and simply unchecked, which is what makes turning the section back on possible — so this
    // asserts the specific heading text rather than the bare word.
    expect(screen.queryByText(/Colonising — \d/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Colonising" })).not.toBeChecked();
    // Its sibling sections are untouched by the one write.
    expect(screen.getByText("Pinned — 0")).toBeInTheDocument();
    expect(screen.getByText("Building — 0")).toBeInTheDocument();
  });
});
