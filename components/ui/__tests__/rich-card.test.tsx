import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RichCard, RichCardContent, RichCardTrigger } from "@/components/ui/rich-card";

// Rendered in jsdom, driven with user-event (real pointer/keyboard event
// sequences, not fire-and-hope) and queried by role/accessible name/focus —
// never by class or style, per the component-test convention. A true
// pointer-transit *geometry* test (does the physical path between trigger
// and content matter) is not something jsdom can honestly answer — it has
// no layout — so the transit test below exercises the time-based grace
// period the implementation actually uses instead, and that limitation is
// called out again in the summary this file's task reports.

// Real timers throughout: Radix's FocusScope/Presence machinery reacts to
// real rAF/timeout scheduling in ways that are fragile under Vitest's fake
// timers. `openDelay` is kept small (40ms) so waits stay fast without
// racing real timers.
const OPEN_DELAY = 40;

function setup() {
  const user = userEvent.setup({ delay: null });
  return { user };
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function renderCard(label = "System row") {
  render(
    <RichCard openDelay={OPEN_DELAY}>
      <RichCardTrigger>
        <button type="button">{label}</button>
      </RichCardTrigger>
      <RichCardContent>
        <p>System vitals</p>
        <button type="button">Unpin</button>
      </RichCardContent>
    </RichCard>,
  );
}

describe("RichCard — open paths differ by how they were opened", () => {
  it("keyboard focus opens the card and moves focus into its content", async () => {
    const { user } = setup();
    renderCard();

    // Tab lands on the trigger (the only tabbable element so far), which
    // opens the card immediately (no openDelay wait) and, by the time this
    // resolves, autofocus has already carried focus on into the content —
    // too fast to observe the intermediate trigger-focused instant.
    await user.tab();
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });
    expect(unpinButton).toHaveFocus();
  });

  it("hover opens the card after openDelay without moving focus into it", async () => {
    const { user } = setup();
    renderCard();

    expect(document.body).toHaveFocus(); // nothing focused yet

    await user.hover(screen.getByRole("button", { name: "System row" }));
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });
    expect(unpinButton).toBeInTheDocument();

    // The two paths differ: hover-open leaves focus exactly where it was —
    // it never jumps into the content the way the keyboard path does above.
    expect(document.body).toHaveFocus();
    expect(unpinButton).not.toHaveFocus();
  });
});

describe("RichCard — a control inside the content is keyboard-operable", () => {
  it("the Unpin button inside the content is reachable and activatable by keyboard", async () => {
    const { user } = setup();
    const onUnpin = vi.fn();
    render(
      <RichCard openDelay={OPEN_DELAY}>
        <RichCardTrigger>
          <button type="button">System row</button>
        </RichCardTrigger>
        <RichCardContent>
          <button type="button" onClick={onUnpin}>
            Unpin
          </button>
        </RichCardContent>
      </RichCard>,
    );

    await user.tab(); // opens via keyboard focus, autofocus lands on Unpin
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });
    expect(unpinButton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });
});

describe("RichCard — Escape dismissal", () => {
  it("closes the card and returns focus to the trigger, not the document body", async () => {
    const { user } = setup();
    renderCard();

    await user.tab();
    const trigger = screen.getByRole("button", { name: "System row" });
    await screen.findByRole("button", { name: "Unpin" });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});

describe("RichCard — pointer transit between trigger and content", () => {
  it("does not close while the pointer moves from the trigger into the content", async () => {
    const { user } = setup();
    renderCard();

    const trigger = screen.getByRole("button", { name: "System row" });
    await user.hover(trigger);
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });

    // Leave the trigger, then land on the content before the close grace
    // period elapses — the card must still be open and its control must
    // still be genuinely clickable (not mid-unmount).
    await user.unhover(trigger);
    await user.hover(unpinButton);

    // Wait well past the internal close-grace window; if transit weren't
    // protected the card would have closed by now.
    await wait(300);
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();

    const onUnpin = vi.fn();
    unpinButton.addEventListener("click", onUnpin);
    await user.click(unpinButton);
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });
});

describe("RichCard — exclusivity", () => {
  it("opening a second card closes the first", async () => {
    const { user } = setup();
    render(
      <>
        <RichCard openDelay={OPEN_DELAY}>
          <RichCardTrigger>
            <button type="button">Row A</button>
          </RichCardTrigger>
          <RichCardContent>
            <p>Vitals for A</p>
          </RichCardContent>
        </RichCard>
        <RichCard openDelay={OPEN_DELAY}>
          <RichCardTrigger>
            <button type="button">Row B</button>
          </RichCardTrigger>
          <RichCardContent>
            <p>Vitals for B</p>
          </RichCardContent>
        </RichCard>
      </>,
    );

    // Hover-open both, deliberately never clicking: a click on B's trigger
    // would count as an "outside" pointerdown for A and Radix would close A
    // on its own, masking whether this component's own exclusivity ever
    // ran. Hover never fires a pointerdown, so this isolates it.
    const rowA = screen.getByRole("button", { name: "Row A" });
    const rowB = screen.getByRole("button", { name: "Row B" });

    await user.hover(rowA);
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();

    // Deliberately no `unhover(rowA)` here: that would schedule A's own
    // (unrelated) pointer-leave close and reintroduce the same race this
    // test exists to avoid — see the note below.
    await user.hover(rowB);
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();

    // Checked immediately, not via `waitFor`: this component's exclusivity
    // closes A synchronously the instant B claims the singleton. A's own
    // pointer-leave grace period was never even started (A's trigger was
    // never unhovered above), so a lingering A here can only mean the
    // cross-card exclusivity itself — not some other timer — failed to fire.
    expect(screen.queryByText("Vitals for A")).not.toBeInTheDocument();
  });
});

describe("RichCard — disableClickOpen suppresses only the click-to-open path", () => {
  // Click-to-open itself has no dedicated test elsewhere in this file (renderCard()'s trigger has
  // never been clicked above) — these three cases close that gap from the opt-out side: a plain
  // click does open by default, `disableClickOpen` suppresses exactly that and nothing else, and
  // the row's own click handler still runs either way (the opt-out exists FOR that handler).

  it("without the opt-out, a click opens the card (the behaviour being opted out of)", async () => {
    const { user } = setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("with the opt-out, a click reaches the trigger's own handler but never opens the card", async () => {
    const { user } = setup();
    const onRowClick = vi.fn();
    render(
      <RichCard openDelay={OPEN_DELAY} disableClickOpen>
        <RichCardTrigger>
          <button type="button" onClick={onRowClick}>
            System row
          </button>
        </RichCardTrigger>
        <RichCardContent>
          <p>System vitals</p>
        </RichCardContent>
      </RichCard>,
    );

    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    // Waited past what would have been the open moment for a click (which, unlike hover, has no
    // delay at all) — confirms this is suppression, not a timing accident.
    await wait(50);
    expect(screen.queryByText("System vitals")).not.toBeInTheDocument();
  });

  it("with the opt-out, hover still opens the card after openDelay", async () => {
    const { user } = setup();
    render(
      <RichCard openDelay={OPEN_DELAY} disableClickOpen>
        <RichCardTrigger>
          <button type="button">System row</button>
        </RichCardTrigger>
        <RichCardContent>
          <p>System vitals</p>
        </RichCardContent>
      </RichCard>,
    );

    await user.hover(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });

  it("with the opt-out, keyboard focus still opens the card", async () => {
    const { user } = setup();
    render(
      <RichCard openDelay={OPEN_DELAY} disableClickOpen>
        <RichCardTrigger>
          <button type="button">System row</button>
        </RichCardTrigger>
        <RichCardContent>
          <p>System vitals</p>
        </RichCardContent>
      </RichCard>,
    );

    await user.tab();
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });
});

describe("RichCard — openDelay guards against a passing pointer", () => {
  it("a pointer that enters and leaves before openDelay elapses never opens the card", async () => {
    const { user } = setup();
    renderCard();

    const trigger = screen.getByRole("button", { name: "System row" });
    await user.hover(trigger);
    await user.unhover(trigger); // leaves well before OPEN_DELAY (40ms) with delay:null

    // Wait past what would have been the open moment, then confirm it
    // never appeared.
    await wait(OPEN_DELAY + 60);
    expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
  });
});
