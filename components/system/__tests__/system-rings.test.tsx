import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SystemRings } from "../system-rings";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { BodyView } from "@/lib/types/api";

// Rendered in jsdom and driven by role, accessible name and DOM attribute — never a class or
// style, per the component-test convention (jsdom has no CSS/layout). Co-ordinates themselves are
// Task 4's job, already pinned in `ring-layout.test.ts`; nothing here re-asserts a cx/cy/radius
// value. `data-orbit-ring`/`data-body-mark` are attributes this component writes itself, not
// classes a stylesheet gives meaning to — same footing as `stroke-dasharray`/`fill`, which are SVG
// presentation attributes read straight off the DOM, not CSS.

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

function setup() {
  return userEvent.setup({ delay: null });
}

describe("SystemRings — locked and occupied markings", () => {
  it("marks a locked body dashed, an occupied body with the status-green fill, independently of each other", () => {
    const bodies = [
      body({ id: "locked", archetypeName: "Locked World", locked: true, occupied: false }),
      body({ id: "occupied", archetypeName: "Occupied World", locked: false, occupied: true, orbitIndex: 2 }),
    ];
    const { container } = render(<SystemRings bodies={bodies} sunClass="yellow" />);

    const lockedMark = container.querySelector('[data-body-mark="locked"]');
    const occupiedMark = container.querySelector('[data-body-mark="occupied"]');
    expect(lockedMark).not.toBeNull();
    expect(occupiedMark).not.toBeNull();

    // Locked: dashed outline, no fill — present but not usable.
    expect(lockedMark).toHaveAttribute("stroke-dasharray");
    expect(lockedMark).toHaveAttribute("fill", "none");
    // Occupied: solid status-green fill, no dash.
    expect(occupiedMark).not.toHaveAttribute("stroke-dasharray");
    expect(occupiedMark).toHaveAttribute("fill", "var(--color-status-green)");
  });
});

describe("SystemRings — the asteroid belt", () => {
  it("renders as its own dashed ring, never a body circle on one", () => {
    const bodies = [body({ id: "belt", bodyType: "asteroid_belt", archetypeName: "Asteroid Belt" })];
    const { container } = render(<SystemRings bodies={bodies} sunClass="yellow" />);

    expect(container.querySelector('[data-body-mark="belt"]')).toBeNull();
    const ring = container.querySelector('[data-orbit-ring="belt"]');
    expect(ring).not.toBeNull();
    expect(ring).toHaveAttribute("stroke-dasharray");
  });

  it("is still reachable and openable by keyboard, like any other body", async () => {
    const user = setup();
    const bodies = [body({ id: "belt", bodyType: "asteroid_belt", archetypeName: "Asteroid Belt" })];
    render(<SystemRings bodies={bodies} sunClass="yellow" />);

    await user.tab();
    expect(await screen.findByRole("heading", { name: "Asteroid Belt" })).toBeInTheDocument();
  });
});

describe("SystemRings — hovering (and keyboard-focusing) a body", () => {
  it("opens that body's own card, naming it and not another body", async () => {
    const user = setup();
    const bodies = [
      body({ id: "b1", archetypeName: "Temperate World" }),
      body({ id: "b2", archetypeName: "Volcanic World", orbitIndex: 2 }),
    ];
    render(<SystemRings bodies={bodies} sunClass="yellow" />);

    await user.tab();
    expect(await screen.findByRole("heading", { name: "Temperate World" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Volcanic World" })).not.toBeInTheDocument();
  });
});

describe("SystemRings — exclusivity", () => {
  it("opening the second body's popover closes the first; the two are never open together", async () => {
    const user = setup();
    const bodies = [
      body({ id: "b1", archetypeName: "Temperate World" }),
      body({ id: "b2", archetypeName: "Volcanic World", orbitIndex: 2 }),
    ];
    render(<SystemRings bodies={bodies} sunClass="yellow" />);

    // Tab into the first body's popover and ArrowDown to ENTER it, then hover the second body.
    // That sequence is the one whose result depends entirely on the shared exclusivity registry:
    // a keyboard-entered popover's own pointer-leave-close is inert (nobody left its trigger by
    // pointer to begin with), and a mere hover on another trigger is neither a click nor a focus
    // change, so Radix's own outside-interaction dismissal never fires either. If the first
    // popover closes here, the registry — not some other close path — is what did it (the same
    // scenario `popover.test.tsx`'s own "survives being taken over" exclusivity test uses).
    await user.tab();
    await screen.findByRole("heading", { name: "Temperate World" });
    await user.keyboard("{ArrowDown}");

    await user.hover(screen.getByRole("button", { name: "Volcanic World" }));
    expect(await screen.findByRole("heading", { name: "Volcanic World" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Temperate World" })).not.toBeInTheDocument();
  });
});

describe("SystemRings — an empty bodies list", () => {
  it("renders nothing, without throwing", () => {
    const { container } = render(<SystemRings bodies={[]} sunClass="yellow" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SystemRings — ring count vs body count", () => {
  it("draws exactly one ring per body, whatever the body count", () => {
    const bodies = Array.from({ length: 5 }, (_, i) => body({ id: `b${i + 1}`, orbitIndex: i + 1 }));
    const { container } = render(<SystemRings bodies={bodies} sunClass="yellow" />);
    expect(container.querySelectorAll("[data-orbit-ring]")).toHaveLength(5);
  });
});
