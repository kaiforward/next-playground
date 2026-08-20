import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerFactionSummary } from "@/components/top-bar";
import type { FactionTreasuryData, FactionVitalsData } from "@/lib/types/api";
import type { AtlasData } from "@/lib/types/game";

// All three hooks are thin wrappers, so mocking them at the module edge is enough — no
// QueryClientProvider, and no fetch for jsdom to fail on (treasury-card.test.tsx's convention).
const { atlasValue, treasuryValue, vitalsValue } = vi.hoisted(() => ({
  atlasValue: { current: null as AtlasData | null },
  treasuryValue: { current: null as FactionTreasuryData | null },
  vitalsValue: { current: null as FactionVitalsData | null },
}));

vi.mock("@/lib/hooks/use-atlas", () => ({
  useAtlas: () => ({ atlas: atlasValue.current }),
}));
vi.mock("@/lib/hooks/use-faction-treasury", () => ({
  useFactionTreasury: () => treasuryValue.current,
}));
vi.mock("@/lib/hooks/use-faction-vitals", () => ({
  useFactionVitals: () => vitalsValue.current,
}));

const BASE_ATLAS: AtlasData = {
  meta: { mapSize: 100, systemCount: 1, seed: 1 },
  regions: [],
  systems: [],
  connections: [],
  factions: [{ id: "f1", name: "Meridian Combine", color: "#3b6ea5" }],
  player: { controlledFactionId: "f1", homeworldSystemId: "sys-1" },
};

function renderSummary({
  player = BASE_ATLAS.player,
  treasury = {},
  vitals = {},
}: {
  player?: AtlasData["player"];
  treasury?: Partial<FactionTreasuryData>;
  vitals?: Partial<FactionVitalsData>;
} = {}) {
  atlasValue.current = { ...BASE_ATLAS, player };
  treasuryValue.current = {
    factionId: "f1", balance: 1000, taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    net: 0, foundingCommitted: 0, lastSettlement: null,
    ...treasury,
  };
  vitalsValue.current = {
    territorySize: 7, activeSystemCount: 5, population: 100, stabilityPct: 80,
    developmentPoints: 10, developmentPotential: 20, developmentPct: 50,
    ...vitals,
  };
  return render(<PlayerFactionSummary />);
}

describe("PlayerFactionSummary — the flag opens the faction panel, the stats quote available money", () => {
  it("renders the flag as a link named for the faction, targeting its panel route", () => {
    renderSummary();
    const flag = screen.getByRole("link", { name: /Meridian Combine/ });
    expect(flag).toHaveAttribute("href", "/factions/f1");
    expect(flag).toHaveAttribute("title", "Meridian Combine");
  });

  it("quotes the AVAILABLE credits (balance minus committed founding money), never the raw balance", () => {
    renderSummary({ treasury: { balance: 1000, foundingCommitted: 400, net: 310 } });
    expect(screen.getByText("600")).toBeInTheDocument();
    expect(screen.queryByText("1000")).not.toBeInTheDocument();
    expect(screen.getByText("+310/cy")).toBeInTheDocument();
  });

  it("signs a negative net with a true minus", () => {
    renderSummary({ treasury: { net: -42 } });
    expect(screen.getByText("−42/cy")).toBeInTheDocument();
  });

  it("shows the owned-system count", () => {
    renderSummary({ vitals: { territorySize: 12 } });
    expect(screen.getByText("Systems owned")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders nothing at all when the world has no player seat", () => {
    const { container } = renderSummary({ player: null });
    expect(container).toBeEmptyDOMElement();
  });
});
