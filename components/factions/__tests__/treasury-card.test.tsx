import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TreasuryCard } from "@/components/factions/treasury-card";
import type { FactionTreasuryData } from "@/lib/types/api";

// Both hooks are thin wrappers, so mocking them at the module edge is enough — no
// QueryClientProvider, and no fetch for jsdom to fail on.
const { treasuryValue } = vi.hoisted(() => ({
  treasuryValue: { current: null as FactionTreasuryData | null },
}));

vi.mock("@/lib/hooks/use-faction-treasury", () => ({
  useFactionTreasury: () => treasuryValue.current,
  useUpdateTreasuryPolicy: () => ({ mutate: vi.fn() }),
}));

function renderCard(treasury: Partial<FactionTreasuryData>) {
  treasuryValue.current = {
    factionId: "f1", balance: 1000, taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    net: 0, foundingCommitted: 0, lastSettlement: null,
    ...treasury,
  };
  return render(<TreasuryCard factionId="f1" interactive />);
}

describe("TreasuryCard — the committed-to-founding line", () => {
  it("shows the committed line while founding has called for money the settlement has not yet charged", () => {
    renderCard({ foundingCommitted: 500 });
    expect(screen.getByText("committed to founding")).toBeInTheDocument();
  });

  it("shows no committed line when nothing is committed", () => {
    renderCard({ foundingCommitted: 0 });
    expect(screen.queryByText("committed to founding")).not.toBeInTheDocument();
  });
});
