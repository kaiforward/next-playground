import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BodyReadout } from "@/components/system/body-readout";
import { emptyResourceVector, makeResourceVector } from "@/lib/engine/resources";
import type { BodyView } from "@/lib/types/api";

// Every case renders `BodyReadout` bare, with no `TooltipProvider`: nothing in this component
// opens a Radix `Tooltip`. Astrography renders it one per row inside a single shared `Card`, and
// the ring diagram's popover renders the same component as its content — so what is asserted here
// is what both surfaces show.

function body(overrides: Partial<BodyView> = {}): BodyView {
  return {
    id: "b1",
    bodyType: "temperate_world",
    archetypeName: "Temperate World",
    score: 1.0,
    locked: false,
    counts: emptyResourceVector(),
    quality: emptyResourceVector(),
    workedCounts: emptyResourceVector(),
    peopleLand: 480,
    occupied: false,
    orbitIndex: 1,
    size: 1,
    ...overrides,
  };
}

describe("BodyReadout — score band, lock state, occupancy marking", () => {
  it("a locked body states its lock in accessible text, below the header row, and shows a score band, never the retired Habitable badge", () => {
    render(<BodyReadout body={body({ bodyType: "volcanic_world", archetypeName: "Volcanic World", score: 0.05, locked: true })} />);
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
    render(<BodyReadout body={body({ score: 0.6 })} />);
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.queryByText("Locked — awaiting technology")).not.toBeInTheDocument();
  });

  it("never renders a per-body deposit yield stat — extraction pooling is a system-level story, never a body-owned one", () => {
    render(<BodyReadout body={body()} />);
    expect(screen.queryByText(/Deposit yield/)).not.toBeInTheDocument();
    expect(screen.queryByText(/contribution weight/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); // the retired stat was this component's only Tooltip trigger
  });

  it("marks only the occupied body — a marking on every body would fail this", () => {
    render(
      <>
        <BodyReadout body={body({ id: "occupied-one", occupied: true })} />
        <BodyReadout body={body({ id: "not-occupied", occupied: false })} />
      </>,
    );
    expect(screen.getAllByText("Occupied")).toHaveLength(1);
  });

  it("a zero-habitable-land body shows an absolute 0, never NaN or a percent", () => {
    const { container } = render(<BodyReadout body={body({ peopleLand: 0 })} />);
    expect(container.textContent).toContain("Habitable land 0");
    expect(container.textContent).not.toContain("People land");
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("never renders a bare 'size N.NN' line — capacity reads through habitable-land and deposit numbers instead", () => {
    const { container } = render(<BodyReadout body={body()} />);
    expect(container.textContent).not.toContain("Size");
  });

  it("shows this body's own worked/total slot count per deposit — a physical fact about the body, never a yield percentage", () => {
    render(
      <BodyReadout
        body={body({
          counts: makeResourceVector({ ore: 3 }),
          quality: makeResourceVector({ ore: 0.9 }),
          workedCounts: makeResourceVector({ ore: 2 }),
        })}
      />,
    );
    expect(screen.getByText("2/3 worked")).toBeInTheDocument();
  });
});
