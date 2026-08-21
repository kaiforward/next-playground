/**
 * The market comparison panel's presence gate (frame-architecture spec, "Interest protocol"),
 * mirroring `components/panels/__tests__/system-panel-presence-gate.test.tsx` for the good-keyed
 * family: `marketComparison[goodId]` absent means "not landed yet" (panel just opened, or the
 * game is paused) — the rows region holds rather than claiming "no visible systems" prematurely,
 * while the panel chrome (header/filter controls) renders regardless.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { seedSlices } from "@/lib/hooks/__tests__/store-fixture";
import { MarketComparisonPanel } from "@/components/market/market-comparison-panel";
import type { MarketComparisonEntry } from "@/lib/types/game";

afterEach(() => {
  vi.restoreAllMocks();
});

// A row's system ("Farport") is distinct from the origin system ("Origin") named in the
// unconditional header subtitle — "Origin" would render regardless of presence, so it can't tell
// the held state apart from the landed one; "Farport" only ever appears via a rendered row.
const ENTRY: MarketComparisonEntry = {
  systemId: "sys-b",
  currentPrice: 42,
  basePrice: 40,
  stock: 100,
};

function renderPanel() {
  return render(
    <MarketComparisonPanel
      goodId="good-a"
      goodName="Widgets"
      fromSystemId="sys-a"
      fromSystemName="Origin"
      systems={[
        { id: "sys-a", name: "Origin" },
        { id: "sys-b", name: "Farport" },
      ]}
      connections={[]}
      onSelectSystem={() => {}}
      onClose={() => {}}
    />
  );
}

describe("MarketComparisonPanel presence gate — goodId not yet in marketComparison", () => {
  it("renders the panel chrome but holds the rows region until the entry lands", () => {
    seedSlices({ marketComparison: {} });
    renderPanel();

    // Chrome: header + filter controls render regardless of presence.
    expect(screen.getByText("Widgets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jumps" })).toBeInTheDocument();
    // Held: neither the empty-state message nor any row — the entry hasn't landed yet, so
    // claiming "no visible systems" would be premature.
    expect(
      screen.queryByText(/No visible systems carry Widgets/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Farport")).not.toBeInTheDocument();

    act(() => {
      seedSlices({ marketComparison: { "good-a": { goodId: "good-a", entries: [ENTRY] } } });
    });

    expect(screen.getByText("Farport")).toBeInTheDocument();
  });

  it("shows the empty-state message once the entry lands with no rows, not before", () => {
    seedSlices({ marketComparison: {} });
    renderPanel();
    expect(
      screen.queryByText(/No visible systems carry Widgets/),
    ).not.toBeInTheDocument();

    act(() => {
      seedSlices({ marketComparison: { "good-a": { goodId: "good-a", entries: [] } } });
    });

    expect(screen.getByText(/No visible systems carry Widgets/)).toBeInTheDocument();
  });
});
