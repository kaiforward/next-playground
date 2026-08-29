import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogisticsPanel } from "@/components/system/logistics-panel";
import { DWELL_OPEN_DELAY_MS, DWELL_MS } from "@/components/ui/popover";
import type { LogisticsGoodRow, SystemLogisticsData } from "@/lib/types/api";

// `BarCell` opens a `dwell` Popover — its trigger is a focusable wrapper round a
// `DivergingBarTrack`, never a text label, so it takes the raw
// `Popover`/`PopoverTrigger asChild`/`PopoverContent` form rather than `PopoverTriggerLabel`.
// `Popover` needs no surrounding provider.

let dataValue: SystemLogisticsData = { visibility: "unknown" };
vi.mock("@/lib/hooks/use-system-logistics", () => ({
  useSystemLogistics: () => dataValue,
}));

function goodRow(overrides: Partial<LogisticsGoodRow> & { goodId: string; goodName: string }): LogisticsGoodRow {
  return {
    tier: 0,
    production: 10,
    consumption: 4,
    inputDemand: 0,
    internalNet: 6,
    importLogistics: 0,
    exportLogistics: 0,
    externalNet: 0,
    traded: false,
    importPartners: [],
    exportPartners: [],
    ...overrides,
  };
}

function renderPanel() {
  return render(<LogisticsPanel systemId="s1" />);
}

/** Hovers a bar cell (found via its row's good name) and waits past the open grace and the dwell,
 *  so the `dwell` popover it belongs to is `locked` — same helper shape as
 *  `industry-panel.test.tsx`'s own. Real timers, matching `components/ui/__tests__/popover.test.tsx`'s
 *  own convention. `cellIndex` picks which `<td>` in the good's row carries the bar (1 = internal,
 *  3 = external). */
async function openBarCell(user: ReturnType<typeof userEvent.setup>, goodName: string, cellIndex: number) {
  const nameCell = screen.getByText(goodName);
  const row = nameCell.closest("tr");
  if (!row) throw new Error(`no <tr> ancestor for "${goodName}"`);
  const cell = row.children[cellIndex];
  const trigger = cell?.querySelector("[tabindex]");
  if (!trigger) throw new Error(`no focusable bar trigger in cell ${cellIndex} of "${goodName}"'s row`);
  await user.hover(trigger);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
  });
}

describe("LogisticsPanel — bar cell dwell popovers", () => {
  it("renders with no popover open — the internal bar's produces/consumes detail appears only once opened", () => {
    dataValue = {
      visibility: "visible",
      rows: [goodRow({ goodId: "metals", goodName: "Metals" })],
      internalMax: 10,
      externalMax: 1,
      activeGoodCount: 1,
      tradedGoodCount: 0,
      volumeHistory: [],
    };
    renderPanel();
    expect(screen.queryByText("Produces")).not.toBeInTheDocument();
  });

  it("opens the internal bar's popover on a good with activity, showing its produces/consumes split", async () => {
    const user = userEvent.setup({ delay: null });
    dataValue = {
      visibility: "visible",
      rows: [goodRow({ goodId: "metals", goodName: "Metals", production: 12, consumption: 5, inputDemand: 3 })],
      internalMax: 12,
      externalMax: 1,
      activeGoodCount: 1,
      tradedGoodCount: 0,
      volumeHistory: [],
    };
    renderPanel();

    await openBarCell(user, "Metals", 1);
    expect(await screen.findByText("Produces")).toBeInTheDocument();
    expect(screen.getByText("Consumes")).toBeInTheDocument();
  });

  it("renders the external bar bare, with no popover, when a good carries no cross-border flow", () => {
    dataValue = {
      visibility: "visible",
      rows: [goodRow({ goodId: "metals", goodName: "Metals", traded: false })],
      internalMax: 10,
      externalMax: 1,
      activeGoodCount: 1,
      tradedGoodCount: 0,
      volumeHistory: [],
    };
    renderPanel();

    const row = screen.getByText("Metals").closest("tr");
    // The external cell (index 3) renders the untraded placeholder, not a focusable bar trigger.
    expect(row?.children[3]?.querySelector("[tabindex]")).toBeNull();
  });

  it("opens the external bar's popover on a traded good, showing its source/destination partners", async () => {
    const user = userEvent.setup({ delay: null });
    dataValue = {
      visibility: "visible",
      rows: [
        goodRow({
          goodId: "metals",
          goodName: "Metals",
          traded: true,
          importLogistics: 4,
          exportLogistics: 2,
          externalNet: -2,
          importPartners: [{ systemId: "sys-a", systemName: "Alpha", quantity: 4 }],
        }),
      ],
      internalMax: 10,
      externalMax: 4,
      activeGoodCount: 1,
      tradedGoodCount: 1,
      volumeHistory: [],
    };
    renderPanel();

    await openBarCell(user, "Metals", 3);
    expect(await screen.findByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
