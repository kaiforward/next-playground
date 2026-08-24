import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuildDialog } from "@/components/construction/build-dialog";
import type { BuildOptionData } from "@/lib/types/api";

// jsdom doesn't implement <dialog>'s imperative methods — `Dialog` (components/ui/dialog.tsx)
// calls `.show()`/`.showModal()`/`.close()` in an effect, which throws without this polyfill.
// Mirrors the scoped polyfill in components/start/__tests__/start-screen.test.tsx.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.show ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
}

vi.mock("@/lib/hooks/use-construction-orders", () => ({
  useOrderBuild: () => ({ mutate: vi.fn(), isPending: false }),
}));

function option(overrides: Partial<BuildOptionData>): BuildOptionData {
  return {
    buildingType: "metals",
    label: "Metals",
    maxLevels: null,
    blocked: null,
    workPerLevel: 10,
    labourAdded: { unskilled: 5, skill1: 0, skill2: 0 },
    estStaffing: 1,
    etaCycles: 3,
    ...overrides,
  };
}

describe("BuildDialog — feasibility readout", () => {
  it("reads 'No ceiling' for a null-maxLevels option, and raises no over-ceiling alert", () => {
    render(
      <BuildDialog
        systemId="s-1"
        systemName="Sol"
        options={[option({ buildingType: "metals", label: "Metals", maxLevels: null })]}
        open
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("No ceiling")).toBeInTheDocument();
    expect(screen.queryByText(/Not enough space/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No free deposit slots/)).not.toBeInTheDocument();
  });

  it("reads the numeric ceiling for a finite-maxLevels option", () => {
    render(
      <BuildDialog
        systemId="s-1"
        systemName="Sol"
        options={[option({ buildingType: "ore", label: "Ore Extractor", maxLevels: 7 })]}
        open
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("No ceiling")).not.toBeInTheDocument();
  });
});
