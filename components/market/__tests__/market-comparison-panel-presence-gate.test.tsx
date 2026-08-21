/**
 * The market comparison panel's presence gate (frame-architecture spec, "Interest protocol"),
 * mirroring `components/panels/__tests__/system-panel-presence-gate.test.tsx` for the good-keyed
 * family: `marketComparison[goodId]` absent means "not landed yet" (panel just opened, or the
 * game is paused) — the rows region (including the visible-market count, review finding 2) holds
 * rather than claiming "no visible systems" prematurely, while the panel chrome (header/filter
 * controls) renders regardless.
 *
 * Uses a REAL catalog good id ("water") rather than an arbitrary one — review finding 1: the
 * detail read used to sit above this gate, so it warned on every ordinary first render for any
 * good that exists in the catalog (which "water" does and an arbitrary id might not), then
 * latched, permanently suppressing the genuine missing-interest case. Asserting `console.warn` is
 * never called during an ordinary gated first render is what pins that fix.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { seedSlices } from "@/lib/hooks/__tests__/store-fixture";
import { MarketComparisonPanel } from "@/components/market/market-comparison-panel";
import type { MarketComparisonEntry } from "@/lib/types/game";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

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
      goodId="water"
      goodName="Water"
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
  it("renders the panel chrome but holds the rows region (and the visible-market count) until the entry lands, without a spurious dev warning", () => {
    seedSlices({ marketComparison: {} });
    renderPanel();

    // Chrome: header + filter controls render regardless of presence.
    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jumps" })).toBeInTheDocument();
    // Held: neither the empty-state message, any row, nor the visible-market count (review finding
    // 2 — the count used to render "0 visible markets" from the fallback while the gate held).
    expect(
      screen.queryByText(/No visible systems carry Water/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Farport")).not.toBeInTheDocument();
    expect(screen.queryByText(/visible market/)).not.toBeInTheDocument();
    // The detail read now lives entirely below the gate — an ordinary first render for a real
    // catalog good must not warn (review finding 1).
    expect(warnSpy).not.toHaveBeenCalled();

    act(() => {
      seedSlices({ marketComparison: { water: { goodId: "water", entries: [ENTRY] } } });
    });

    expect(screen.getByText("Farport")).toBeInTheDocument();
    expect(screen.getByText("1 visible market")).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("shows the empty-state message once the entry lands with no rows, not before", () => {
    seedSlices({ marketComparison: {} });
    renderPanel();
    expect(
      screen.queryByText(/No visible systems carry Water/),
    ).not.toBeInTheDocument();

    act(() => {
      seedSlices({ marketComparison: { water: { goodId: "water", entries: [] } } });
    });

    expect(screen.getByText(/No visible systems carry Water/)).toBeInTheDocument();
    expect(screen.getByText("0 visible markets")).toBeInTheDocument();
  });
});
