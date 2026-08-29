import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvisionBlock } from "@/components/system/provision-block";
import { DWELL_OPEN_DELAY_MS, DWELL_MS } from "@/components/ui/popover";
import type { PopNeedData, SystemProvisionRead } from "@/lib/types/api";

// The band widths, tones and the ledger split are tested against numbers in `provision-view` and
// `needs-view`. What is left for the DOM is what a reader actually gets: the chip, the headline,
// the key naming both numbers, and which need rows are on screen.
//
// The ledger's rows are `dwell`-popover triggers: a row's body is its own need data rather than a
// fixed definition — `Popover` needs no surrounding provider, unlike Radix's `Tooltip.Root`.

const assessed: SystemProvisionRead = {
  assessed: true,
  pct: 68,
  band: "strained",
  expectationPct: 84,
};

function need(overrides: Partial<PopNeedData> & { goodId: string; goodName: string; satisfaction: number }): PopNeedData {
  return {
    want: 10,
    delivered: 9,
    pressure: 0.05,
    breakdown: { base: 5, technicians: 3, engineers: 2 },
    ...overrides,
  };
}

function renderBlock(read: SystemProvisionRead, needs: PopNeedData[] = []) {
  return render(<ProvisionBlock read={read} needs={needs} />);
}

/** Same helper shape as `industry-panel.test.tsx`'s own — hovers a need row (found by its good
 *  name, since the row itself carries no single accessible name) and waits past the open grace
 *  and the dwell, so the `dwell` popover it belongs to is `locked` by the time this resolves. Real
 *  timers, matching `components/ui/__tests__/popover.test.tsx`'s own convention. */
async function openNeedRow(user: ReturnType<typeof userEvent.setup>, goodName: string) {
  const row = screen.getByText(goodName).closest("tr");
  if (!row) throw new Error(`no <tr> ancestor for "${goodName}"`);
  await user.hover(row);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
  });
}

describe("ProvisionBlock — band chip, percentage, track key, and the absent state", () => {
  it("assessed: renders the band chip, the percentage, and a Now/Used-to key naming both numbers", () => {
    renderBlock(assessed);
    expect(screen.getByText("Strained")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(screen.getByText("Now 68%")).toBeInTheDocument();
    expect(screen.getByText("Used to 84%")).toBeInTheDocument();
    // the design pass's restraint: no band-name labels stamped onto the track's own segments
    expect(screen.queryByText("Rationing")).not.toBeInTheDocument();
    expect(screen.queryByText("Supplied")).not.toBeInTheDocument();
  });

  it("unassessed: renders the absent state — no percentage, no crash — with a distinct chip", () => {
    renderBlock({ assessed: false });
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
    expect(screen.getByText(/Not yet assessed/)).toBeInTheDocument();
    expect(screen.queryByText(/^Now /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Used to /)).not.toBeInTheDocument();
  });

  it("empty needs renders the ledger's own empty state beneath the block, not a missing section", () => {
    renderBlock(assessed);
    expect(screen.getByText("No needs.")).toBeInTheDocument();
  });

  it("the moved ledger keeps its collapsed met tail and input ordering — a met need is folded behind the expand toggle, and inline problem rows keep the order the service pressure-sorted them in", async () => {
    const needs: PopNeedData[] = [
      need({ goodId: "critical-good", goodName: "Critical good", satisfaction: 0.2 }), // critical, highest pressure first
      need({ goodId: "short-good", goodName: "Short good", satisfaction: 0.8 }), // short
      need({ goodId: "met-good", goodName: "Met good", satisfaction: 0.99 }), // met — collapsed
    ];
    renderBlock(assessed, needs);

    // Pressure ordering preserved, read off the rows themselves rather than off markup offsets.
    // Row 0 is the header, so the problems are rows 1 and 2 — in that order.
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Critical good");
    expect(rows[2]).toHaveTextContent("Short good");

    // The met good is folded behind the toggle, not rendered as its own row…
    expect(screen.queryByText("Met good")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /1 needs met/ });

    // …and the toggle is what brings it back, which is the only reason hiding it is acceptable.
    await userEvent.click(toggle);
    expect(screen.getByText("Met good")).toBeInTheDocument();
  });

  it("opens a need row's own dwell popover, naming the good and its want/delivered/pressure breakdown — Task 8's conversion of NeedRow to a Popover", async () => {
    const user = userEvent.setup({ delay: null });
    const needs: PopNeedData[] = [
      need({ goodId: "critical-good", goodName: "Critical good", satisfaction: 0.2, want: 12, delivered: 4 }),
    ];
    renderBlock(assessed, needs);

    await openNeedRow(user, "Critical good");
    expect(await screen.findByText(/want 12\.00\/cyc/)).toBeInTheDocument();
    expect(screen.getByText(/delivered 4\.00\/cyc/)).toBeInTheDocument();
  });
});
