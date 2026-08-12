import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PinToggle } from "@/components/system/pin-toggle";
import type { AtlasData } from "@/lib/types/game";
import type { TrackerData, TrackerPinnedRow } from "@/lib/types/api";

// PinToggle owns two suspense-backed hooks (useTracker, useAtlas) and a mutation
// (useSetSystemPin). All three are mocked directly, the same approach tracker-panel.test.tsx
// uses — QueryBoundary's Suspense/ErrorBoundary/QueryErrorResetBoundary machinery needs no
// QueryClient context of its own (only useSuspenseQuery does, and that call never runs here).

const setPinMutate = vi.fn();

vi.mock("@/lib/hooks/use-player-pins", () => ({
  useSetSystemPin: () => ({ mutate: setPinMutate, isPending: false }),
}));

let atlasPlayer: AtlasData["player"];
vi.mock("@/lib/hooks/use-atlas", () => ({
  useAtlas: () => ({
    atlas: {
      meta: { mapSize: 100, systemCount: 1, seed: 1 },
      regions: [],
      systems: [],
      connections: [],
      factions: [],
      get player() {
        return atlasPlayer;
      },
    } as AtlasData,
  }),
}));

let trackerData: TrackerData;
vi.mock("@/lib/hooks/use-tracker", () => ({
  useTracker: () => trackerData,
}));

function pinnedRow(systemId: string): TrackerPinnedRow {
  return {
    systemId,
    systemName: "Sunnyvale",
    population: 2,
    populationPct: 40,
    stabilityPct: 82,
    provisionPct: 90,
    developmentPct: 55,
  };
}

function emptyTracker(): TrackerData {
  return { pinned: [], building: [], waitingCount: 0, colonising: [] };
}

beforeEach(() => {
  setPinMutate.mockClear();
  atlasPlayer = { controlledFactionId: "f1", homeworldSystemId: "sys-a" };
  trackerData = emptyTracker();
});

describe("PinToggle — pressed state reflects the current pin", () => {
  it("a system already on the pinned list renders pressed, not as unpinned", () => {
    trackerData = { ...emptyTracker(), pinned: [pinnedRow("sys-a")] };
    render(<PinToggle systemId="sys-a" />);

    const button = screen.getByRole("button", { name: /unpin/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("a system NOT on the pinned list renders unpressed", () => {
    trackerData = { ...emptyTracker(), pinned: [pinnedRow("sys-other")] };
    render(<PinToggle systemId="sys-a" />);

    const button = screen.getByRole("button", { name: /pin/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});

describe("PinToggle — two activations return to the starting state", () => {
  it("pin then unpin sends true then false, and the rendered state ends back where it started", async () => {
    const user = userEvent.setup();
    // The mock mutate writes straight back into the shared trackerData and forces a rerender via
    // the caller — this stands in for the real mutation's onSuccess invalidating + refetching the
    // tracker query, without pulling in a real QueryClient.
    setPinMutate.mockImplementation((input: { systemId: string; pinned: boolean }) => {
      trackerData = {
        ...trackerData,
        pinned: input.pinned
          ? [...trackerData.pinned, pinnedRow(input.systemId)]
          : trackerData.pinned.filter((p) => p.systemId !== input.systemId),
      };
    });

    const { rerender } = render(<PinToggle systemId="sys-a" />);
    expect(screen.getByRole("button", { name: /pin/i })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button"));
    expect(setPinMutate).toHaveBeenNthCalledWith(1, { systemId: "sys-a", pinned: true });
    rerender(<PinToggle systemId="sys-a" />);
    expect(screen.getByRole("button", { name: /unpin/i })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button"));
    expect(setPinMutate).toHaveBeenNthCalledWith(2, { systemId: "sys-a", pinned: false });
    rerender(<PinToggle systemId="sys-a" />);

    // Back to the starting state — not a second pin, and not left pinned.
    const finalButton = screen.getByRole("button", { name: /pin/i });
    expect(finalButton).toHaveAttribute("aria-pressed", "false");
    expect(setPinMutate).toHaveBeenCalledTimes(2);
  });
});

describe("PinToggle — distinct from the header's other pin-shaped control", () => {
  // The glyph itself (star vs. lucide's MapPin) is a rendered SVG path — asserting which one
  // reached the DOM means asserting a class or an internal SVG structure, which this codebase's
  // testing convention forbids (AGENTS.md: never classes or styles). That half of this Proves
  // entry is NOT honestly testable here and is not claimed as covered — see the task report.
  // What IS testable from the DOM: the two controls in this header carry accessible names that do
  // not collide, so a screen reader user is never asked to disambiguate two things both called
  // "Show on map" or similar.
  it("the toggle's accessible name never equals the neighboring 'Show on map' control's name", () => {
    render(<PinToggle systemId="sys-a" />);
    // Uses Testing Library's real accessible-name computation (getByRole's `name` matcher), not a
    // raw `.accessibleName` DOM read — jsdom doesn't implement that property, so reading it would
    // silently return undefined and pass vacuously regardless of what the control is actually named.
    expect(screen.queryByRole("button", { name: "Show on map" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pin/i })).toBeInTheDocument();
  });
});

describe("PinToggle — operable by keyboard", () => {
  it("tabbing to the control and pressing Enter activates it, with no pointer involved", async () => {
    const user = userEvent.setup();
    render(<PinToggle systemId="sys-a" />);

    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(setPinMutate).toHaveBeenCalledWith({ systemId: "sys-a", pinned: true });
  });

  it("the Space key also activates it, matching native button semantics", async () => {
    const user = userEvent.setup();
    render(<PinToggle systemId="sys-a" />);

    await user.tab();
    await user.keyboard(" ");
    expect(setPinMutate).toHaveBeenCalledWith({ systemId: "sys-a", pinned: true });
  });
});

describe("PinToggle — a world with no player seat", () => {
  it("renders nothing, rather than a control that would error on activation", () => {
    atlasPlayer = null;
    render(<PinToggle systemId="sys-a" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Nothing to click, so nothing can send a doomed mutation.
    expect(setPinMutate).not.toHaveBeenCalled();
  });
});
