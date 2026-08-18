import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ColonySection } from "@/components/construction/colony-section";
import { COLONY_BLOCK_COPY } from "@/lib/types/colonisation";
import { formatCredits } from "@/lib/utils/format";
import type { ColonyPreviewData, SystemBuildOptionsData, SystemConstructionData } from "@/lib/types/api";

// All three hooks are thin `useSuspenseQuery`/mutation wrappers, so mocking them at the module edge
// is enough — no QueryClientProvider, and no fetch for jsdom to fail on.
const { constructionValue, buildSurface } = vi.hoisted(() => ({
  constructionValue: { current: { visibility: "hidden" } as SystemConstructionData },
  buildSurface: { current: { mode: "none" } as SystemBuildOptionsData },
}));

vi.mock("@/lib/hooks/use-system-construction", () => ({
  useSystemConstruction: () => constructionValue.current,
}));
vi.mock("@/lib/hooks/use-build-options", () => ({
  useSystemBuildOptions: () => buildSurface.current,
}));
vi.mock("@/lib/hooks/use-construction-orders", () => ({
  useOrderColony: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelOrder: () => ({ mutate: vi.fn() }),
}));

const preview: ColonyPreviewData = {
  sourceSystemId: "s-home", sourceSystemName: "Sol", seedPop: 2, housingLevels: 1, work: 84,
  charter: 1200, projectedBill: 3400, commitment: 8000,
};

describe("ColonySection — the founding quote on the blocked verb", () => {
  beforeEach(() => {
    constructionValue.current = { visibility: "hidden" };
  });

  it("renders the quote under a money-blocked verb, with the block copy after it", () => {
    buildSurface.current = {
      mode: "colony", colony: { state: "ineligible", reason: "insufficient_funds", preview },
    };
    render(<ColonySection systemId="s-target" />);

    expect(screen.getByRole("button", { name: /Establish colony/ })).toBeDisabled();
    expect(screen.getByText("Sol")).toBeInTheDocument();
    expect(screen.getByText(formatCredits(1200))).toBeInTheDocument();
    expect(screen.getByText(formatCredits(3400))).toBeInTheDocument();
    expect(screen.getByText(COLONY_BLOCK_COPY.insufficient_funds)).toBeInTheDocument();
    // The gate's whole threshold is stated, so the panel can never look affordable while refusing.
    expect(screen.getByText(formatCredits(8000))).toBeInTheDocument();
    expect(screen.getByText(/requires/)).toBeInTheDocument();
  });

  it("renders no quote on a physical block that carries none", () => {
    buildSurface.current = {
      mode: "colony", colony: { state: "ineligible", reason: "no_seed_source", preview: null },
    };
    render(<ColonySection systemId="s-target" />);

    expect(screen.getByRole("button", { name: /Establish colony/ })).toBeDisabled();
    expect(screen.queryByText(/of materials/)).not.toBeInTheDocument();
    expect(screen.getByText(COLONY_BLOCK_COPY.no_seed_source)).toBeInTheDocument();
  });

  it("renders the same quote lines on the eligible verb, without any block copy", () => {
    buildSurface.current = { mode: "colony", colony: { state: "eligible", preview } };
    render(<ColonySection systemId="s-target" />);

    expect(screen.getByRole("button", { name: /Establish colony/ })).toBeEnabled();
    expect(screen.getByText("Sol")).toBeInTheDocument();
    expect(screen.getByText(formatCredits(1200))).toBeInTheDocument();
    expect(screen.queryByText(COLONY_BLOCK_COPY.insufficient_funds)).not.toBeInTheDocument();
  });
});
