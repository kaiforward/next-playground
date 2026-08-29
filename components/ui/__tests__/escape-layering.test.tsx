import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DWELL_MS, DWELL_OPEN_DELAY_MS } from "@/components/ui/popover";

// jsdom implements no scrolling, so `Element.scrollTo` is absent — `DetailPanel` calls it in an
// effect to reset the body's offset between subjects. Mirrors the scoped `<dialog>` polyfill in
// components/construction/__tests__/build-dialog.test.tsx.
if (typeof Element !== "undefined") {
  Element.prototype.scrollTo ??= function () {};
}

const navigate = vi.fn();
vi.mock("@/components/ui/link-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/link-provider")>()),
  useNavigate: () => navigate,
}));

/**
 * Escape belongs to ONE thing at a time — the innermost thing the player is reading.
 *
 * Every dismissable layer in the app (`Popover`, and Radix's tooltip) claims Escape in the CAPTURE
 * phase and marks the event handled. Surfaces underneath — a `DetailPanel`, a non-modal `Dialog` —
 * listen in the bubble phase, so they run afterwards and have to respect that mark. Without it one
 * Escape both dismisses the popover the player was reading AND navigates the panel out from behind
 * it, which is two dismissals for one keypress and loses the place they were reading from.
 *
 * Real timers, matching `popover.test.tsx`'s own convention: Radix's Presence machinery is fragile
 * under fake ones.
 */
async function openLockedPopover(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.hover(screen.getByRole("button", { name }));
  await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
}

function Scene() {
  return (
    <DetailPanel title="System panel" backPath="/">
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Combined yield</button>
        </PopoverTrigger>
        <PopoverContent title="Combined yield">
          <p>Definition of combined yield</p>
        </PopoverContent>
      </Popover>
    </DetailPanel>
  );
}

describe("Escape layering — the innermost dismissable layer consumes the key", () => {
  it("dismisses the popover without also closing the panel behind it", async () => {
    navigate.mockClear();
    const user = userEvent.setup();
    render(<Scene />);

    await openLockedPopover(user, "Combined yield");
    expect(await screen.findByText("Definition of combined yield")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText("Definition of combined yield")).not.toBeInTheDocument();
    });
    // The panel is still open and the player is still where they were.
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Combined yield" })).toBeInTheDocument();
  });

  it("still closes the panel on Escape once no popover is open", async () => {
    navigate.mockClear();
    const user = userEvent.setup();
    render(<Scene />);

    // The panel's own Escape is not disabled by this rule — only deferred while something is
    // layered above it. With nothing open, the very same key closes the panel as it always did.
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/");
    });
  });
});
