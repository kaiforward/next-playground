import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BodyCard } from "@/components/system/body-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { BodyView } from "@/lib/types/api";

// Every case renders inside the app's own `TooltipProvider` — Radix's `Tooltip.Root` throws
// without a provider above it (the real app mounts one in client/main.tsx), and other tooltips on
// the card (e.g. a future addition) would need it even though the retired deposit-yield tooltip
// no longer does.

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

describe("BodyCard — score band, lock state, occupancy marking", () => {
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

  it("never renders a per-body deposit yield stat — extraction pooling is a system-level story, never a body-owned one", () => {
    renderCard(body());
    expect(screen.queryByText(/Deposit yield/)).not.toBeInTheDocument();
    expect(screen.queryByText(/contribution weight/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); // the retired stat was the card's only Tooltip trigger
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
