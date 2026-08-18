import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertChip } from "@/components/alerts/alert-chip";
import type {
  ControlledSystemsAlertCategory,
  EventAlertCategory,
  FactionAlertCategory,
  SystemScopedAlertCategory,
} from "@/lib/types/api";

// Chips are icon-plus-count with no visible label, so every assertion here is either the
// accessible name built from rendered DOM content, or whether an element renders at all (the
// fault slash, the carve-out) — never a class or a style, since jsdom carries no CSS.
//
// AlertChip no longer owns any open/close state or click/keyboard handling — it renders as a plain
// `PopoverTrigger` child (`components/alerts/alert-run.tsx`), so it takes no `open`/`onOpen` props
// and is rendered directly here with no `Popover` wrapper: it makes no `usePopoverContext` call of
// its own. The disclosure mechanics that used to be pinned in this file — a click or Enter opening
// it, `aria-expanded` reflecting that state — are Radix's `PopoverTrigger` contract now, exercised
// generically in `components/ui/__tests__/popover.test.tsx` (its "click opens", "keyboard focus
// opens" and `pointerInert`/`clickInert` cases all drive a real `PopoverTrigger`).

// The slash is identified by the geometry that makes it a slash, rather than by a marker attribute
// added for the test's benefit. The casing line beneath it carries a different `d`, so this matches
// the slash alone.
const FAULT_SLASH = 'path[d="m2 2 20 20"]';

const famine: SystemScopedAlertCategory = {
  id: "famine",
  unit: "developed_systems",
  count: 3,
  denominator: 253,
  instances: [],
};

const colonyOpportunity: ControlledSystemsAlertCategory = {
  id: "colony_opportunity",
  unit: "controlled_systems",
  count: 3,
  denominator: 12,
  instances: [],
};

const crisis: EventAlertCategory = {
  id: "crisis",
  unit: "events",
  count: 2,
  instances: [],
};

const maintenanceUnfunded: FactionAlertCategory = {
  id: "maintenance_unfunded",
  unit: "faction",
  count: 1,
  instances: [],
};

const buildBlocked: SystemScopedAlertCategory = {
  id: "build_blocked",
  unit: "developed_systems",
  count: 5,
  denominator: 253,
  instances: [],
};

describe("AlertChip — accessible name carries the category, count and its own unit", () => {
  it("a developed-systems category reads count and denominator: 'Famine, 3 of 253 developed systems'", () => {
    render(<AlertChip category={famine} />);
    expect(
      screen.getByRole("button", { name: "Famine, 3 of 253 developed systems" }),
    ).toBeInTheDocument();
  });

  it("a controlled-systems category reads its own denominator: 'Colony opportunity, 3 of 12 controlled systems'", () => {
    render(<AlertChip category={colonyOpportunity} />);
    expect(
      screen.getByRole("button", { name: "Colony opportunity, 3 of 12 controlled systems" }),
    ).toBeInTheDocument();
  });

  it("an events category names its unit and carries no systems denominator: 'Crisis, 2 events'", () => {
    render(<AlertChip category={crisis} />);
    expect(screen.getByRole("button", { name: "Crisis, 2 events" })).toBeInTheDocument();
    expect(screen.queryByText(/developed systems/)).not.toBeInTheDocument();
  });

  it("the faction-level Maintenance unfunded chip carries a bare count, no denominator", () => {
    render(<AlertChip category={maintenanceUnfunded} />);
    expect(screen.getByRole("button", { name: "Maintenance unfunded, 1" })).toBeInTheDocument();
    expect(screen.queryByText(/developed systems/)).not.toBeInTheDocument();
  });
});

describe("AlertChip — the fault slash", () => {
  it("renders for a category the registry marks faulted (Build blocked)", () => {
    const { container } = render(<AlertChip category={buildBlocked} />);
    expect(container.querySelector(FAULT_SLASH)).not.toBeNull();
  });

  it("does not render for a category the registry does not mark faulted (Famine)", () => {
    const { container } = render(<AlertChip category={famine} />);
    expect(container.querySelector(FAULT_SLASH)).toBeNull();
  });
});

