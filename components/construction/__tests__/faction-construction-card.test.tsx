import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactionConstructionCard } from "@/components/construction/faction-construction-card";
import type { FactionConstructionData, FactionTreasuryData } from "@/lib/types/api";
import type { WorldTreasurySettlement } from "@/lib/world/types";
import type { TreasuryBands } from "@/lib/engine/treasury";

// Both hooks are thin `useSuspenseQuery` wrappers, so mocking them at the module edge is enough —
// no QueryClientProvider, and no fetch for jsdom to fail on.
const { treasuryValue, constructionValue } = vi.hoisted(() => ({
  treasuryValue: { current: null as FactionTreasuryData | null },
  constructionValue: { current: null as FactionConstructionData | null },
}));

vi.mock("@/lib/hooks/use-faction-treasury", () => ({
  useFactionTreasury: () => treasuryValue.current,
}));
vi.mock("@/lib/hooks/use-faction-construction", () => ({
  useFactionConstruction: () => constructionValue.current,
}));
vi.mock("@/lib/hooks/use-construction-orders", () => ({
  useSetAutomation: () => ({ mutate: vi.fn() }),
}));

const bands = (maintenance: number, logistics: number, construction: number): TreasuryBands =>
  ({ maintenance, logistics, construction });

function settlement(paid: TreasuryBands, charged?: TreasuryBands): WorldTreasurySettlement {
  return {
    tick: 240, headsIncome: 0, productionIncome: 0, incomeBySystem: [],
    maintenanceBill: 0, maintenanceByType: [], logisticsBill: 0, constructionBill: 40,
    paid, charged, foundingExpense: 0,
  };
}

/** Renders the card for one faction whose treasury is in the given state. */
function renderCard(treasury: Partial<FactionTreasuryData>) {
  constructionValue.current = {
    factionId: "f1", pool: 100, poolBase: 100, poolCentres: 0, automation: null,
    buildSystems: [], colonies: [], orderedCount: 0,
  };
  treasuryValue.current = {
    factionId: "f1", balance: 1000, taxLevel: "normal",
    bands: bands(1, 1, 1), funded: bands(1, 1, 1), net: 0, lastSettlement: null,
    ...treasury,
  };
  return render(<FactionConstructionCard factionId="f1" />);
}

describe("FactionConstructionCard — the construction band's shorted tag", () => {
  it("does not tag a faction whose last settlement paid construction in full but whose slider has since been raised", () => {
    // The last settlement ran construction at a 0.5 slider: asked 20 of a 40 bill, paid all 20. The
    // player has since pushed the slider to 1.0 with no settlement in between, so `funded` (0.5) now
    // sits below the live slider (1.0) while nothing whatsoever went unpaid. Reading that gap fires
    // the badge for taking the corrective action, and keeps firing while the game is paused.
    renderCard({
      bands: bands(1, 1, 1),
      funded: bands(1, 1, 0.5),
      lastSettlement: settlement(bands(0, 0, 20), bands(0, 0, 20)),
    });

    expect(screen.getByText(/50%/)).toBeInTheDocument(); // the latched fraction is still reported
    expect(screen.queryByText(/shorted/)).not.toBeInTheDocument();
  });

  it("tags a faction whose last settlement genuinely could not pay the construction it was asked for", () => {
    // Asked 40, paid 9 — a real shortfall, and it must show regardless of where the slider sits now.
    renderCard({
      bands: bands(1, 1, 1),
      funded: bands(1, 1, 0.225),
      lastSettlement: settlement(bands(0, 0, 9), bands(0, 0, 40)),
    });

    expect(screen.getByText(/shorted/)).toBeInTheDocument();
  });

  it("tags a real shortfall even when the player has since LOWERED the slider below the latched fraction", () => {
    // The mirror failure: `funded` 0.6 above a live slider of 0.5 reads solvent to anything comparing
    // the two, while the settlement itself was asked 32 and paid 24.
    renderCard({
      bands: bands(1, 1, 0.5),
      funded: bands(1, 1, 0.6),
      lastSettlement: settlement(bands(0, 0, 24), bands(0, 0, 32)),
    });

    expect(screen.getByText(/shorted/)).toBeInTheDocument();
  });

  it("does not tag a faction that has never settled", () => {
    renderCard({ bands: bands(1, 1, 1), funded: bands(1, 1, 0), lastSettlement: null });

    expect(screen.queryByText(/shorted/)).not.toBeInTheDocument();
  });

  it("renders the pool composition and the empty state alongside, whatever the tag says", () => {
    renderCard({ lastSettlement: null });

    expect(screen.getByText("Construction")).toBeInTheDocument();
    expect(screen.getByText("No active construction or expansion.")).toBeInTheDocument();
  });
});
