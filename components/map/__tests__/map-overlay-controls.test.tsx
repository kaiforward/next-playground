import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapOverlayControls } from "@/components/map/map-overlay-controls";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MapOverlays } from "@/lib/hooks/use-map-overlays";

// Rendered in jsdom, driven with a real user-event hover and queried by role/accessible name and
// text — never by class or style, per the component-test convention (AGENTS.md -> Testing).

// Radix's `Tooltip.Arrow` needs `ResizeObserver`, which jsdom doesn't provide — stubbed here, same
// convention as components/ui/__tests__/term-label.test.tsx and
// components/system/__tests__/industry-panel.test.tsx.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

const NO_OVERLAYS: MapOverlays = { logistics: false };

function renderControls() {
  const user = userEvent.setup({ delay: null });
  render(
    <TooltipProvider>
      <MapOverlayControls
        mode="lanes"
        setMode={() => {}}
        overlays={NO_OVERLAYS}
        toggle={() => {}}
      />
    </TooltipProvider>,
  );
  return { user };
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MapOverlayControls — the Lanes mode option and its legend", () => {
  it("renders a Lanes radio option", () => {
    renderControls();
    expect(screen.getByRole("radio", { name: "Lanes" })).toBeInTheDocument();
  });

  it("the Lanes option's tooltip names the three bands and the no-investor/congested lines", async () => {
    const { user } = renderControls();
    await user.hover(screen.getByRole("radio", { name: "Lanes" }));
    // Radix Tooltip's own default open delay (no `delayDuration` override here) — a real duration,
    // not a shortened test double, matching industry-panel.test.tsx's own LegendTooltip case.
    await wait(900);

    expect((await screen.findAllByText("Fine")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Busy")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Congested")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/no investor/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/turned volume away this run/i)).length).toBeGreaterThan(0);
  });
});
