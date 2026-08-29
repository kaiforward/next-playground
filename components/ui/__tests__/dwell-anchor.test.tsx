import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { Popover, PopoverContent, PopoverTrigger, DWELL_OPEN_DELAY_MS } from "@/components/ui/popover";

// Permanent regression guard: jsdom cannot see where the dwell popover actually renders (no
// layout), but it CAN see exactly what rect our own `dwellAnchorVirtualRef.getBoundingClientRect`
// reports to Radix — the one thing that determines where a real browser places it. This pins that
// rect to the dispatched pointer position so a future change that leaves `cursorAnchoredRef`
// unset, or `dwellAnchorPointRef`/`dwellPointerRef` unseeded, at the moment Radix first reads the
// anchor is caught here instead of only visually, in a browser, later.
//
// Interception, not mocking of our own code: `@radix-ui/react-popover`'s `Anchor` is wrapped only
// to capture the `virtualRef` prop Popover hands it — every one of Popover's own trigger/content
// components, and all of their pointer-count/leave-grace machinery, run for real.

type Measurable = { getBoundingClientRect: () => DOMRect };
let capturedVirtualRef: { current: Measurable } | null = null;

vi.mock("@radix-ui/react-popover", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@radix-ui/react-popover")>();
  return {
    ...actual,
    Anchor: (props: ComponentProps<typeof actual.Anchor>) => {
      if (props.virtualRef) {
        capturedVirtualRef = props.virtualRef as unknown as { current: Measurable };
      }
      return <actual.Anchor {...props} />;
    },
  };
});

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function renderDwellPopover() {
  render(
    <Popover dwell openDelay={DWELL_OPEN_DELAY_MS}>
      <PopoverTrigger>
        <button type="button">Term</button>
      </PopoverTrigger>
      <PopoverContent>
        <button type="button">Nested control</button>
      </PopoverContent>
    </Popover>,
  );
}

describe("Popover — dwell anchor reports the cursor, not the origin", () => {
  it("reports the exact dispatched pointer position the instant it opens", async () => {
    const user = userEvent.setup({ delay: null });
    renderDwellPopover();
    const trigger = screen.getByRole("button", { name: "Term" });

    await user.pointer({ target: trigger, coords: { clientX: 500, clientY: 300 } });
    await wait(DWELL_OPEN_DELAY_MS + 20);
    await screen.findByRole("button", { name: "Nested control" });

    expect(capturedVirtualRef).not.toBeNull();
    const rect = capturedVirtualRef!.current.getBoundingClientRect();
    expect({ x: rect.x, y: rect.y }).toEqual({ x: 500, y: 300 });
  });

  it("reports a second, independent open at a different pointer position — not a stale or zeroed rect", async () => {
    const user = userEvent.setup({ delay: null });
    renderDwellPopover();
    const trigger = screen.getByRole("button", { name: "Term" });

    await user.pointer({ target: trigger, coords: { clientX: 500, clientY: 300 } });
    await wait(DWELL_OPEN_DELAY_MS + 20);
    await screen.findByRole("button", { name: "Nested control" });
    await user.unhover(trigger);
    await wait(500);

    await user.pointer({ target: trigger, coords: { clientX: 120, clientY: 640 } });
    await wait(DWELL_OPEN_DELAY_MS + 20);
    await screen.findByRole("button", { name: "Nested control" });

    const rect = capturedVirtualRef!.current.getBoundingClientRect();
    expect({ x: rect.x, y: rect.y }).toEqual({ x: 120, y: 640 });
  });
});
