import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TreasuryCard } from "@/components/factions/treasury-card";
import type { FactionTreasuryData } from "@/lib/types/api";
import type { TreasuryPolicyInput } from "@/lib/schemas/treasury";

// Both hooks are thin wrappers, so mocking them at the module edge is enough — no
// QueryClientProvider, and no fetch for jsdom to fail on.
const { treasuryValue, mutateMock } = vi.hoisted(() => ({
  treasuryValue: { current: null as FactionTreasuryData | null },
  mutateMock: vi.fn(),
}));

vi.mock("@/lib/hooks/use-faction-treasury", () => ({
  useFactionTreasury: () => treasuryValue.current,
  useUpdateTreasuryPolicy: () => ({ mutate: mutateMock }),
}));

function renderCard(treasury: Partial<FactionTreasuryData>, interactive = true) {
  mutateMock.mockClear();
  treasuryValue.current = {
    factionId: "f1", balance: 1000, taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    net: 0, foundingCommitted: 0, lastSettlement: null,
    stockpileScale: 1,
    ...treasury,
  };
  return render(<TreasuryCard factionId="f1" interactive={interactive} />);
}

describe("TreasuryCard — available money leads, committed founding reconciles", () => {
  it("headlines the AVAILABLE balance while founding has called for money, with the total as the footnote", () => {
    renderCard({ balance: 1000, foundingCommitted: 400 });
    expect(screen.getByText("600")).toBeInTheDocument();        // the headline: 1000 − 400
    expect(screen.queryByText("1000")).not.toBeInTheDocument(); // the raw total is not the headline…
    expect(screen.getByText(/total/)).toBeInTheDocument();      // …it moves to the reconciling footnote
    expect(screen.getByText(/committed to founding/)).toBeInTheDocument();
  });

  it("shows the plain balance and no footnote when nothing is committed", () => {
    renderCard({ balance: 1000, foundingCommitted: 0 });
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.queryByText(/committed to founding/)).not.toBeInTheDocument();
  });
});

describe("TreasuryCard — stockpile control", () => {
  it("offers exactly the Lean / Normal / Deep step list", () => {
    renderCard({ stockpileScale: 1 });
    const group = screen.getByRole("radiogroup", { name: "Stockpile" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["0.75", "1", "1.5"]);
    expect(within(group).getByRole("radio", { name: "Lean" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Normal" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Deep" })).toBeInTheDocument();
  });

  it("commits one policy write carrying only stockpileScale when a step is picked", async () => {
    const user = userEvent.setup();
    renderCard({ stockpileScale: 1 });

    await user.click(screen.getByRole("radio", { name: "Deep" }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const input: TreasuryPolicyInput = mutateMock.mock.calls[0][0];
    expect(input).toEqual({ stockpileScale: 1.5 });
  });

  it("does not respond to a click on an AI faction's card", async () => {
    const user = userEvent.setup();
    renderCard({ stockpileScale: 1 }, false);

    await user.click(screen.getByRole("radio", { name: "Deep" }));

    expect(mutateMock).not.toHaveBeenCalled();
  });
});
