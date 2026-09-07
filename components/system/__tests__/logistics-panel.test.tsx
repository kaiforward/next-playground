import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogisticsPanel } from "@/components/system/logistics-panel";
import { hoverUntilLocked } from "@/components/system/__tests__/dwell-popover-test-utils";
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
    role: "consumer",
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

/** Locates a bar cell's trigger by its own accessible name (`"<good> — Internal"`/
 *  `"<good> — External"`, the `BarCell` `title`) rather than a bare `[tabindex]` selector, so a
 *  markup change that preserves focusability but drops the trigger's name still fails here.
 *  `cellIndex` picks which `<td>` in the good's row carries the bar (2 = internal, 4 = external —
 *  Good and Role are the two cells ahead of the Internal bar). */
async function openBarCell(user: ReturnType<typeof userEvent.setup>, goodName: string, cellIndex: number) {
  const nameCell = screen.getByText(goodName);
  const row = nameCell.closest("tr");
  if (!row) throw new Error(`no <tr> ancestor for "${goodName}"`);
  const cell = row.children[cellIndex];
  if (!cell) throw new Error(`no cell ${cellIndex} in "${goodName}"'s row`);
  const kind = cellIndex === 2 ? "Internal" : "External";
  const trigger = within(cell as HTMLElement).getByLabelText(`${goodName} — ${kind}`);
  await hoverUntilLocked(user, trigger);
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
      transit: { inbound: [], outbound: [] },
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
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    await openBarCell(user, "Metals", 2);
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
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    const row = screen.getByText("Metals").closest("tr");
    // The external cell (index 3) renders the untraded placeholder, not a focusable bar trigger.
    expect(row?.children[4]?.querySelector("[tabindex]")).toBeNull();
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
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    await openBarCell(user, "Metals", 4);
    expect(await screen.findByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("LogisticsPanel — role and its lines", () => {
  it("shows a supplier's role word plus its two deciding numbers", () => {
    dataValue = {
      visibility: "visible",
      rows: [
        goodRow({
          goodId: "metals", goodName: "Metals", role: "supplier",
          givesDownToCycles: 10, wantCycles: 12,
          steadyInbound: 4.2, lateInboundShare: 0.04,
        }),
      ],
      internalMax: 10, externalMax: 1, activeGoodCount: 1, tradedGoodCount: 0, volumeHistory: [],
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    const row = screen.getByText("Metals").closest("tr");
    if (!row) throw new Error("no <tr> ancestor for Metals");
    expect(within(row as HTMLElement).getByText("Supplier")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("4.2/cyc")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("4%")).toBeInTheDocument();
  });

  it("shows a consumer row's cycle lines but neither of the supplier's deciding numbers", () => {
    dataValue = {
      visibility: "visible",
      rows: [
        goodRow({
          goodId: "metals", goodName: "Metals", role: "consumer",
          givesDownToCycles: 40, wantCycles: 45,
          // Set as if stale/inconsistent data reached the panel — the role gate, not the data's
          // own absence, is what must keep a consumer row from showing the supplier's numbers.
          steadyInbound: 4.2, lateInboundShare: 0.04,
        }),
      ],
      internalMax: 10, externalMax: 1, activeGoodCount: 1, tradedGoodCount: 0, volumeHistory: [],
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    const row = screen.getByText("Metals").closest("tr");
    if (!row) throw new Error("no <tr> ancestor for Metals");
    expect(within(row as HTMLElement).getByText("Consumer")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("40.0 cycles")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("45.0 cycles")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText(/\/cyc/)).not.toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText(/%/)).not.toBeInTheDocument();
  });

  it("renders an unknown-rate market as a consumer with no placeholder in its numbers", () => {
    dataValue = {
      visibility: "visible",
      // No demand-derived fields set at all — the same reading a market with an unknown rolling
      // rate gets: role falls back to consumer, and every cycle figure stays absent.
      rows: [goodRow({ goodId: "metals", goodName: "Metals", role: "consumer" })],
      internalMax: 10, externalMax: 1, activeGoodCount: 1, tradedGoodCount: 0, volumeHistory: [],
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    const row = screen.getByText("Metals").closest("tr");
    if (!row) throw new Error("no <tr> ancestor for Metals");
    expect(within(row as HTMLElement).getByText("Consumer")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("—")).not.toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("n/a")).not.toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText(/cycles/)).not.toBeInTheDocument();
  });

  it("shows an idle row's realised use against full-rate use, not the supplier's numbers", () => {
    dataValue = {
      visibility: "visible",
      rows: [
        goodRow({
          goodId: "metals", goodName: "Metals", role: "idle",
          consumption: 4, inputDemand: 6, givesDownToCycles: 10, wantCycles: 9.6,
          realisedUse: 1.2,
        }),
      ],
      internalMax: 10, externalMax: 1, activeGoodCount: 1, tradedGoodCount: 0, volumeHistory: [],
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();

    const row = screen.getByText("Metals").closest("tr");
    if (!row) throw new Error("no <tr> ancestor for Metals");
    expect(within(row as HTMLElement).getByText("Idle")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("12% of full rate")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText(/\/cyc/)).not.toBeInTheDocument();
  });
});

describe("LogisticsPanel — in-transit card", () => {
  it("renders nothing under In transit when neither direction has a row", () => {
    dataValue = {
      visibility: "visible",
      rows: [goodRow({ goodId: "metals", goodName: "Metals" })],
      internalMax: 10, externalMax: 1, activeGoodCount: 1, tradedGoodCount: 0, volumeHistory: [],
      transit: { inbound: [], outbound: [] },
    };
    renderPanel();
    expect(screen.queryByText("In transit")).not.toBeInTheDocument();
  });

  it("lists inbound and outbound rows under their own labelled section, linking the far system", () => {
    dataValue = {
      visibility: "visible",
      rows: [goodRow({ goodId: "metals", goodName: "Metals" })],
      internalMax: 10, externalMax: 1, activeGoodCount: 1, tradedGoodCount: 0, volumeHistory: [],
      transit: {
        inbound: [{ goodId: "water", goodName: "Water", quantity: 18, otherSystemId: "sys-a", otherSystemName: "Halden Reach", arrivalTick: 30 }],
        outbound: [{ goodId: "alloys", goodName: "Alloys", quantity: 8, otherSystemId: "sys-b", otherSystemName: "Sable", arrivalTick: 60 }],
      },
    };
    renderPanel();

    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(screen.getByText(/Inbound/)).toHaveTextContent("Inbound · 1");
    expect(screen.getByText(/Outbound/)).toHaveTextContent("Outbound · 1");
    expect(screen.getByRole("link", { name: "Halden Reach" })).toHaveAttribute("href", "/system/sys-a");
    expect(screen.getByRole("link", { name: "Sable" })).toHaveAttribute("href", "/system/sys-b");
  });
});
