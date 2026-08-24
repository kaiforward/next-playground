import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BodyCard } from "@/components/system/body-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { BodyView } from "@/lib/types/api";

// Every case renders inside the app's own `TooltipProvider` — the extraction-weight readout is a
// Tooltip trigger, and Radix's `Tooltip.Root` throws without a provider above it (the real app
// mounts one in client/main.tsx). The contribution-weight wording lives directly on the trigger's
// own visible text (not behind a hover-only tooltip body), so it is readable via the trigger's
// accessible name without simulating a hover/focus interaction.

function body(overrides: Partial<BodyView> = {}): BodyView {
  return {
    id: "b1",
    bodyType: "temperate_world",
    archetypeName: "Temperate World",
    score: 1.0,
    locked: false,
    counts: emptyResourceVector(),
    quality: emptyResourceVector(),
    peopleLand: 480,
    extractionModifier: 1.0,
    occupied: false,
    ...overrides,
  };
}

function renderCard(b: BodyView) {
  return render(
    <TooltipProvider>
      <BodyCard body={b} />
    </TooltipProvider>,
  );
}

describe("BodyCard — score band, lock state, occupancy marking, and the deposit yield stat", () => {
  it("a locked body states its lock in accessible text, below the header row, and shows a score band, never the retired Habitable badge", () => {
    renderCard(body({ bodyType: "volcanic_world", archetypeName: "Volcanic World", score: 0.05, locked: true }));
    const lockedBadge = screen.getByText("Locked — awaiting technology");
    expect(lockedBadge).toBeInTheDocument();
    expect(screen.getByText("Poor")).toBeInTheDocument(); // 0.05 bands as poor
    expect(screen.queryByText("Habitable")).not.toBeInTheDocument();

    // The lock badge sits on its own row below the header, not sharing the header's flex row with
    // the archetype name — the layout defect this replaces pushed the modifier text offscreen.
    const heading = screen.getByRole("heading", { name: "Volcanic World" });
    const headerRow = heading.parentElement;
    expect(headerRow).not.toBeNull();
    expect(headerRow).not.toContainElement(lockedBadge);
  });

  it("an unlocked above-threshold body shows its score band without a lock marker", () => {
    renderCard(body({ score: 0.6 }));
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.queryByText("Locked — awaiting technology")).not.toBeInTheDocument();
  });

  it("renders the deposit-yield stat as a percentage on the trigger's accessible name", () => {
    renderCard(body({ extractionModifier: 0.85 }));
    expect(screen.getByRole("button", { name: /Deposit yield/ })).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.queryByText(/contribution weight/)).not.toBeInTheDocument();
    expect(screen.queryByText("×0.85")).not.toBeInTheDocument();
  });

  it("marks only the occupied body — a marking on every body would fail this", () => {
    render(
      <TooltipProvider>
        <BodyCard body={body({ id: "occupied-one", occupied: true })} />
        <BodyCard body={body({ id: "not-occupied", occupied: false })} />
      </TooltipProvider>,
    );
    expect(screen.getAllByText("Occupied")).toHaveLength(1);
  });

  it("a zero-habitable-land body shows an absolute 0, never NaN or a percent", () => {
    const { container } = renderCard(body({ peopleLand: 0 }));
    expect(container.textContent).toContain("Habitable land 0");
    expect(container.textContent).not.toContain("People land");
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("never renders a bare 'size N.NN' line — capacity reads through habitable-land and deposit numbers instead", () => {
    const { container } = renderCard(body());
    expect(container.textContent).not.toContain("Size");
  });
});
