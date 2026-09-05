import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimSection } from "@/components/construction/claim-section";
import { formatDuration } from "@/lib/utils/calendar";
import { LANES } from "@/lib/constants/lanes";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import type { SystemBuildOptionsData } from "@/lib/types/api";

const { buildSurface, claimMutate } = vi.hoisted(() => {
  const buildSurface: { current: SystemBuildOptionsData } = { current: { mode: "none" } };
  return { buildSurface, claimMutate: vi.fn() };
});

vi.mock("@/lib/hooks/use-build-options", () => ({
  useSystemBuildOptions: () => buildSurface.current,
}));
vi.mock("@/lib/hooks/use-claims", () => ({
  useClaimSystem: () => ({ mutate: claimMutate, isPending: false }),
}));

describe("ClaimSection", () => {
  beforeEach(() => {
    buildSurface.current = { mode: "none" };
    claimMutate.mockClear();
  });

  it("renders nothing when the system carries no claim option", () => {
    render(<ClaimSection systemId="s-target" systemName="Ashfall" />);
    expect(screen.queryByText("Territory")).not.toBeInTheDocument();
  });

  it("enables the claim verb and quotes the cooldown length when eligible", () => {
    buildSurface.current = {
      mode: "claim",
      claim: { state: "eligible", adjacentOwned: [{ systemId: "s-kerrin", systemName: "Kerrin" }] },
    };
    render(<ClaimSection systemId="s-target" systemName="Ashfall" />);

    expect(screen.getByText("Territory")).toBeInTheDocument();
    expect(screen.getByText(/Borders/)).toHaveTextContent("Unclaimed. Borders Kerrin, which you hold.");
    const button = screen.getByRole("button", { name: /Claim system/ });
    expect(button).toBeEnabled();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === `free · brings the Kerrin — Ashfall lane under your control · next claim in ${formatDuration(LANES.PLAYER_CLAIM_COOLDOWN * CYCLE_LENGTH)}`,
      ),
    ).toBeInTheDocument();

    button.click();
    expect(claimMutate).toHaveBeenCalledTimes(1);
  });

  it("disables the claim verb during cooldown, naming the remaining time", () => {
    buildSurface.current = {
      mode: "claim",
      claim: {
        state: "cooldown",
        adjacentOwned: [{ systemId: "s-kerrin", systemName: "Kerrin" }],
        remainingTicks: 240,
      },
    };
    render(<ClaimSection systemId="s-target" systemName="Ashfall" />);

    const button = screen.getByRole("button", { name: /Claim system/ });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(new RegExp(`ready in ${formatDuration(240)}`)),
    ).toBeInTheDocument();
  });

  it("names every owned neighbour when a system borders more than one", () => {
    buildSurface.current = {
      mode: "claim",
      claim: {
        state: "eligible",
        adjacentOwned: [
          { systemId: "s-kerrin", systemName: "Kerrin" },
          { systemId: "s-marrow", systemName: "Marrow" },
        ],
      },
    };
    render(<ClaimSection systemId="s-target" systemName="Ashfall" />);
    expect(screen.getByText(/Borders/)).toHaveTextContent("Unclaimed. Borders Kerrin, Marrow, which you hold.");
  });
});
