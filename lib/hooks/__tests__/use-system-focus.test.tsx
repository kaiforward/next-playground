import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSystemFocus, useLaneFocus } from "@/lib/hooks/use-system-focus";
import type { AtlasData } from "@/lib/types/game";

// The nonce is the whole subject here. `useSystemFocus()` writes `loc` into a single URL read by a
// single consumer — `star-map.tsx`'s recentre effect, keyed on `focus|loc` — while the app mounts
// MANY instances of the hook: the Tracker's, plus one per visible alert chip. What has to hold is a
// property of the URL's own history, not of any one caller's, so these tests drive two independent
// consumers rather than one.

const push = vi.fn();
vi.mock("@/components/ui/link-provider", () => ({
  useNavigate: () => push,
}));

const ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 2, seed: 1 },
  regions: [],
  systems: [
    {
      id: "sys-a",
      x: 12,
      y: 7,
      regionId: "region-1",
      factionId: null,
      economyType: "agricultural",
      isGateway: false,
      developed: true,
      sunClass: "yellow",
    },
    {
      id: "sys-b",
      x: 20,
      y: 15,
      regionId: "region-1",
      factionId: null,
      economyType: "agricultural",
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

beforeEach(() => {
  push.mockClear();
});

/** One independent consumer of the hook — its own component, so each rendered copy is a separate
 *  hook instance, exactly as the Tracker and each alert chip's flyout are. */
function Locator({ label }: { label: string }) {
  const focusSystem = useSystemFocus();
  return (
    <button type="button" onClick={() => focusSystem("sys-a", "")}>
      {label}
    </button>
  );
}

function locOf(url: unknown): number {
  const match = typeof url === "string" ? /&loc=(\d+)$/.exec(url) : null;
  return match ? Number(match[1]) : NaN;
}

describe("useSystemFocus — the locate nonce is a property of the URL, not of one caller", () => {
  it("two different consumers locating the same system emit two different URLs", async () => {
    // The failure this pins: with a per-instance counter, both consumers start at 0, both emit
    // `loc=1` for the same system, the map's `focus|loc` key never changes, and the second locate
    // opens the panel while the camera stays wherever the player last panned it.
    const user = userEvent.setup();
    render(
      <>
        <Locator label="Locate from the Tracker" />
        <Locator label="Locate from a chip" />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Locate from the Tracker" }));
    await user.click(screen.getByRole("button", { name: "Locate from a chip" }));

    expect(push).toHaveBeenCalledTimes(2);
    const first = locOf(push.mock.calls[0]?.[0]);
    const second = locOf(push.mock.calls[1]?.[0]);
    expect(Number.isFinite(first)).toBe(true);
    expect(second).toBeGreaterThan(first);
    expect(push.mock.calls[0]?.[0]).not.toBe(push.mock.calls[1]?.[0]);
  });

  it("a consumer mounted fresh does not restart the nonce behind an earlier one", async () => {
    // A chip unmounts whenever its category's count returns to zero and mounts again when it fires
    // next. A counter that lived on the instance would reset with it, replaying `loc` values the URL
    // has already carried.
    const user = userEvent.setup();
    const { unmount } = render(<Locator label="First" />);
    await user.click(screen.getByRole("button", { name: "First" }));
    unmount();

    render(<Locator label="Second" />);
    await user.click(screen.getByRole("button", { name: "Second" }));

    expect(locOf(push.mock.calls[1]?.[0])).toBeGreaterThan(locOf(push.mock.calls[0]?.[0]));
  });

  it("does not navigate at all for a system the atlas does not know", async () => {
    const user = userEvent.setup();
    function UnknownLocator() {
      const focusSystem = useSystemFocus();
      return (
        <button type="button" onClick={() => focusSystem("sys-missing", "")}>
          Locate
        </button>
      );
    }
    render(<UnknownLocator />);
    await user.click(screen.getByRole("button", { name: "Locate" }));

    expect(push).not.toHaveBeenCalled();
  });
});

/** A lane-row consumer — `useLaneFocus()`'s own stand-in for `Locator` above. */
function LaneLocator({ label, laneKey }: { label: string; laneKey: string }) {
  const focusLane = useLaneFocus();
  return (
    <button type="button" onClick={() => focusLane(laneKey)}>
      {label}
    </button>
  );
}

describe("useLaneFocus — the lane card's own fly-to, on the same channel and nonce", () => {
  it("navigates to the lane's own href, focused on its two endpoints' midpoint", async () => {
    const user = userEvent.setup();
    render(<LaneLocator label="Locate lane" laneKey="sys-a|sys-b" />);

    await user.click(screen.getByRole("button", { name: "Locate lane" }));

    expect(push).toHaveBeenCalledTimes(1);
    // Midpoint of (12,7) and (20,15) is (16,11).
    expect(push.mock.calls[0]?.[0]).toMatch(/^\/lane\/sys-a%7Csys-b\?focus=16,11&loc=\d+$/);
  });

  it("shares the monotonic nonce with useSystemFocus — a system locate then a lane locate never repeats loc", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Locator label="Locate system" />
        <LaneLocator label="Locate lane" laneKey="sys-a|sys-b" />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Locate system" }));
    await user.click(screen.getByRole("button", { name: "Locate lane" }));

    expect(locOf(push.mock.calls[1]?.[0])).toBeGreaterThan(locOf(push.mock.calls[0]?.[0]));
  });

  it("does not navigate for a lane whose endpoint the atlas does not know", async () => {
    const user = userEvent.setup();
    render(<LaneLocator label="Locate lane" laneKey="sys-a|sys-missing" />);

    await user.click(screen.getByRole("button", { name: "Locate lane" }));

    expect(push).not.toHaveBeenCalled();
  });

  it("does not navigate for a malformed lane key", async () => {
    const user = userEvent.setup();
    render(<LaneLocator label="Locate lane" laneKey="not-a-lane-key" />);

    await user.click(screen.getByRole("button", { name: "Locate lane" }));

    expect(push).not.toHaveBeenCalled();
  });
});
