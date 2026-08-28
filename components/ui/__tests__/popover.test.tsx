import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverContent, PopoverTrigger, usePopoverDepth } from "@/components/ui/popover";

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

function renderPopover(label = "System row") {
  render(
    <Popover openDelay={OPEN_DELAY}>
      <PopoverTrigger>
        <button type="button">{label}</button>
      </PopoverTrigger>
      <PopoverContent>
        <p>System vitals</p>
        <button type="button">Unpin</button>
      </PopoverContent>
    </Popover>,
  );
}

describe("Popover — no open path moves focus", () => {
  it("keyboard focus opens the popover and leaves focus on the trigger", async () => {
    const { user } = setup();
    renderPopover();

    // Tab lands on the trigger (the only tabbable element so far), which
    // opens the popover immediately — no openDelay wait. Focus stays put: a
    // popover describes the thing its trigger already is, and it is portalled
    // to the end of the document, so a popover that took focus here would put
    // every later trigger behind it in tab order.
    await user.tab();
    const trigger = screen.getByRole("button", { name: "System row" });
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("hover opens the popover after openDelay without moving focus into it", async () => {
    const { user } = setup();
    renderPopover();

    expect(document.body).toHaveFocus(); // nothing focused yet

    await user.hover(screen.getByRole("button", { name: "System row" }));
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });
    expect(unpinButton).toBeInTheDocument();

    // Hover-open leaves focus exactly where it was — it does not even give
    // it to the trigger, which the keyboard path above already had.
    expect(document.body).toHaveFocus();
    expect(unpinButton).not.toHaveFocus();
  });
});

describe("Popover — ArrowDown is the way into a popover", () => {
  it("the Unpin button inside the content is reachable and activatable by keyboard", async () => {
    const { user } = setup();
    const onUnpin = vi.fn();
    render(
      <Popover openDelay={OPEN_DELAY}>
        <PopoverTrigger>
          <button type="button">System row</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" onClick={onUnpin}>
            Unpin
          </button>
        </PopoverContent>
      </Popover>,
    );

    await user.tab(); // the trigger — the popover opens beside it, focus stays here
    await screen.findByRole("button", { name: "Unpin" });

    // The deliberate way in. Nothing before this press moved focus, so a
    // control in a popover is keyboard-operable without a popover ever grabbing.
    await user.keyboard("{ArrowDown}");
    const unpinButton = screen.getByRole("button", { name: "Unpin" });
    expect(unpinButton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown on a closed popover opens it and enters it in the one press", async () => {
    const { user } = setup();
    renderPopover();
    const trigger = screen.getByRole("button", { name: "System row" });

    // Tab in, Escape out: the popover is closed with focus still on the
    // trigger, which is the state a second ArrowDown has to handle — there
    // is no content to move focus into when the key is pressed.
    await user.tab();
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("button", { name: "Unpin" })).toHaveFocus();
  });

  it("focuses the content itself when the popover holds nothing focusable", async () => {
    const { user } = setup();
    render(
      <Popover openDelay={OPEN_DELAY}>
        <PopoverTrigger>
          <button type="button">System row</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Rigel vitals">
          <p>Stability 82%</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    await screen.findByText("Stability 82%");
    await user.keyboard("{ArrowDown}");

    // Nothing inside is focusable, but the popover still has to be reachable
    // or a screen reader driven by the keyboard can never be told to read
    // it. Focus lands on the popover itself.
    expect(screen.getByRole("dialog", { name: "Rigel vitals" })).toHaveFocus();
  });

  it("advertises the gesture on the trigger, so it can be announced rather than guessed at", async () => {
    renderPopover();
    // The only place a screen-reader user could learn the popover exists and how to get into it —
    // read out with the trigger's own name.
    expect(screen.getByRole("button", { name: "System row" })).toHaveAttribute(
      "aria-keyshortcuts",
      "ArrowDown",
    );
  });

  it("consumes the key, so the page does not scroll as well", async () => {
    const { user } = setup();
    // What a scrolling page sees: the press reaches the document either
    // way, and `defaultPrevented` is the only thing telling it this
    // ArrowDown was spent on entering a popover. Recorded rather than asserted
    // inside the listener — jsdom swallows a throw from an event handler.
    const prevented: boolean[] = [];
    const record = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") prevented.push(event.defaultPrevented);
    };
    document.addEventListener("keydown", record);
    try {
      renderPopover();
      await user.tab();
      await screen.findByRole("button", { name: "Unpin" });
      await user.keyboard("{ArrowDown}");
      expect(prevented).toEqual([true]);
    } finally {
      document.removeEventListener("keydown", record);
    }
  });
});

describe("Popover — Tab cycles inside an entered popover", () => {
  function renderTwoControlPopover() {
    render(
      <Popover openDelay={OPEN_DELAY}>
        <PopoverTrigger>
          <button type="button">System row</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button">Unpin</button>
          <button type="button">Show on map</button>
        </PopoverContent>
      </Popover>,
    );
  }

  it("Tab at the last control wraps to the first, and Shift+Tab at the first wraps to the last", async () => {
    const { user } = setup();
    renderTwoControlPopover();

    await user.tab();
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{ArrowDown}");

    const unpin = screen.getByRole("button", { name: "Unpin" });
    const showOnMap = screen.getByRole("button", { name: "Show on map" });
    expect(unpin).toHaveFocus();

    await user.tab();
    expect(showOnMap).toHaveFocus();

    // The popover is portalled to the END of the document, so "the next
    // tabbable after the last control" is nothing at all — this wrap is
    // what stops focus falling into that void, and it is why Escape can be
    // the deliberate way out rather than the only escape from a dead end.
    await user.tab();
    expect(unpin).toHaveFocus();

    await user.tab({ shift: true });
    expect(showOnMap).toHaveFocus();
  });
});

describe("Popover — Escape is the way back out", () => {
  it("from inside the popover, closes it and puts focus back on the trigger", async () => {
    const { user } = setup();
    renderPopover();
    const trigger = screen.getByRole("button", { name: "System row" });

    await user.tab();
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();

    // Escape is the counterpart of the ArrowDown that entered: it has to
    // land the user back where they came from, not on the document body
    // with the popover (and the element that had focus) gone from the DOM.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("a popover the pointer opened and the keyboard entered still returns focus to its trigger", async () => {
    const { user } = setup();
    renderPopover();
    const trigger = screen.getByRole("button", { name: "System row" });

    // Reaching a pointer-opened popover with focus already on its trigger: Tab
    // in, Escape out (focus stays on the trigger, popover closed), then the
    // pointer reopens it. The popover is now flagged pointer-opened, and a
    // pointer-opened popover deliberately suppresses the focus return on close
    // — that suppression is what stops hovering row-to-row killing the popover
    // it just opened.
    await user.tab();
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();

    await user.hover(trigger);
    await screen.findByRole("button", { name: "Unpin" });

    // Entering by keyboard makes it keyboard-driven from here on, so the
    // suppression no longer applies and Escape hands the trigger back.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("closes the popover and returns focus to the trigger, not the document body", async () => {
    const { user } = setup();
    renderPopover();

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

describe("Popover — pointer transit between trigger and content", () => {
  it("does not close while the pointer moves from the trigger into the content", async () => {
    const { user } = setup();
    renderPopover();

    const trigger = screen.getByRole("button", { name: "System row" });
    await user.hover(trigger);
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });

    // Leave the trigger, then land on the content before the close grace
    // period elapses — the popover must still be open and its control must
    // still be genuinely clickable (not mid-unmount).
    await user.unhover(trigger);
    await user.hover(unpinButton);

    // Wait well past the internal close-grace window; if transit weren't
    // protected the popover would have closed by now.
    await wait(300);
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();

    const onUnpin = vi.fn();
    unpinButton.addEventListener("click", onUnpin);
    await user.click(unpinButton);
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("closes a hover-opened popover the pointer clicked into once the pointer leaves", async () => {
    const { user } = setup();
    renderPopover();
    const trigger = screen.getByRole("button", { name: "System row" });

    // Pure pointer use throughout: hover the row, move into the popover, press a control in it. The
    // click puts focus inside the content — which is NOT the same thing as the keyboard having
    // been driven in there, and gating the grace period on where focus happens to be left this
    // popover open indefinitely, with no gesture that would shut it short of clicking elsewhere.
    await user.hover(trigger);
    const unpinButton = await screen.findByRole("button", { name: "Unpin" });
    await user.unhover(trigger);
    await user.hover(unpinButton);
    await user.click(unpinButton);
    expect(unpinButton).toHaveFocus();

    await user.unhover(unpinButton);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
  });

  it("the pointer leaving does not close a popover the keyboard is inside", async () => {
    const { user } = setup();
    renderPopover();
    const trigger = screen.getByRole("button", { name: "System row" });

    await user.tab();
    await user.hover(trigger);
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();

    // The user stopped driving with the pointer when they entered. Closing
    // on the grace period now would pull the popover out from under a keyboard
    // reader mid-read; Escape is their way out, and only theirs.
    await user.unhover(trigger);
    await wait(300);
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();
  });
});

describe("Popover — exclusivity", () => {
  it("opening a second popover closes the first", async () => {
    const { user } = setup();
    render(
      <>
        <Popover openDelay={OPEN_DELAY}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for A</p>
          </PopoverContent>
        </Popover>
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row B</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for B</p>
          </PopoverContent>
        </Popover>
      </>,
    );

    // Both popovers are opened by HOVER, and neither trigger is ever clicked or
    // focused. Both of those would close A through a path of Radix's own —
    // an outside pointerdown, or a focusin outside the layer, each of which
    // dismisses the open popover directly — and A would then vanish whether
    // or not this component's exclusivity ever ran. Hover is the only open
    // path that leaves the first popover's fate entirely to the code under
    // test. What hover cannot avoid is that moving the one shared pointer to
    // B fires `pointerleave` on A, starting A's own 150ms close grace; the
    // margin below is what keeps that from deciding the result.
    const rowA = screen.getByRole("button", { name: "Row A" });
    const rowB = screen.getByRole("button", { name: "Row B" });

    await user.hover(rowA);
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();

    // B's `openDelay` is 0 so that B opens on the macrotask right after the
    // pointer arrives, leaving the assertion below ~150ms clear of the grace
    // period A started when the pointer left it. Checked immediately, not via
    // `waitFor`: exclusivity closes A synchronously the instant B claims the
    // singleton, so a lingering A here is a real failure — and only a stall
    // longer than the whole grace period could make it a false pass.
    await user.hover(rowB);
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for A")).not.toBeInTheDocument();
  });

  it("the popover that took over stays open, and the closed popover takes no focus", async () => {
    const { user } = setup();
    render(
      <>
        <Popover openDelay={OPEN_DELAY}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for A</p>
          </PopoverContent>
        </Popover>
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row B</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for B</p>
          </PopoverContent>
        </Popover>
      </>,
    );

    await user.hover(screen.getByRole("button", { name: "Row A" }));
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "Row B" }));
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();

    // Sliding the pointer down a list of rows is the main way this thing is
    // used, so B has to still be there a moment later. A hover-opened popover
    // never took focus, so A must not hand any back on its way out: that
    // focus would land on A's trigger, and a focusin outside B's layer is
    // all Radix needs to dismiss B — B would open and vanish in the same
    // frame, and the keyboard caret would silently sit on the row above.
    await wait(200);
    expect(screen.getByText("Vitals for B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Row A" })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("a popover the keyboard had ENTERED also survives being taken over — the second popover stays", async () => {
    const { user } = setup();
    render(
      <>
        <Popover openDelay={OPEN_DELAY}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <button type="button">Unpin A</button>
          </PopoverContent>
        </Popover>
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row B</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for B</p>
          </PopoverContent>
        </Popover>
      </>,
    );
    const rowA = screen.getByRole("button", { name: "Row A" });

    // Tab onto A and go in, then reach for the mouse: the mixed sequence. Suppressing the focus
    // return on "the popover was opened by a pointer" got this wrong, because an entered popover is by
    // definition not one of those — A handed focus back to its own trigger, that focus landed
    // outside B, and Radix dismissed B on the spot. B flashed and vanished, and with the pointer
    // already inside row B no further `pointerenter` would ever fire to bring it back.
    await user.tab();
    await screen.findByRole("button", { name: "Unpin A" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin A" })).toHaveFocus();

    await user.hover(screen.getByRole("button", { name: "Row B" }));
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpin A" })).not.toBeInTheDocument();

    // Well past both the dismissal Radix would do in the same frame and A's own close grace.
    await wait(200);
    expect(screen.getByText("Vitals for B")).toBeInTheDocument();
    // The cost of getting there, pinned so it can't drift unnoticed: A's focus is NOT handed back
    // to its trigger, because that is the very thing that killed B. It falls to the document body
    // instead (see the limitation in Popover's docblock).
    expect(rowA).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});

describe("Popover — clickInert takes the click out of BOTH the open and the close gesture", () => {
  // Click-to-open itself has no dedicated test elsewhere in this file (renderPopover()'s trigger has
  // never been clicked above) — these cases close that gap from the opt-out side: a plain click does
  // open by default and Radix's toggle would close an open popover, `clickInert` suppresses both
  // halves of that toggle and nothing else, and the row's own click handler still runs either way
  // (the opt-out exists FOR that handler). The already-open case is the one that pins the close
  // half: hover-open a Tracker row's card, click the row to fly the map, and the card stays up.

  it("without the opt-out, a click opens the popover (the behaviour being opted out of)", async () => {
    const { user } = setup();
    renderPopover();
    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("with the opt-out, a click reaches the trigger's own handler but never opens the popover", async () => {
    const { user } = setup();
    const onRowClick = vi.fn();
    render(
      <Popover openDelay={OPEN_DELAY} clickInert>
        <PopoverTrigger>
          <button type="button" onClick={onRowClick}>
            System row
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <p>System vitals</p>
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    // Waited past what would have been the open moment for a click (which, unlike hover, has no
    // delay at all) — confirms this is suppression, not a timing accident.
    await wait(50);
    expect(screen.queryByText("System vitals")).not.toBeInTheDocument();
  });

  it("with the opt-out, hover still opens the popover after openDelay", async () => {
    const { user } = setup();
    render(
      <Popover openDelay={OPEN_DELAY} clickInert>
        <PopoverTrigger>
          <button type="button">System row</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>System vitals</p>
        </PopoverContent>
      </Popover>,
    );

    await user.hover(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });

  it("with the opt-out, clicking a trigger whose popover is ALREADY open leaves it open", async () => {
    const { user } = setup();
    const onRowClick = vi.fn();
    render(
      <Popover openDelay={OPEN_DELAY} clickInert>
        <PopoverTrigger>
          <button type="button" onClick={onRowClick}>
            System row
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <p>System vitals</p>
        </PopoverContent>
      </Popover>,
    );

    const trigger = screen.getByRole("button", { name: "System row" });
    await user.hover(trigger);
    expect(await screen.findByText("System vitals")).toBeInTheDocument();

    await user.click(trigger);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await wait(200);
    expect(screen.getByText("System vitals")).toBeInTheDocument();
  });

  it("with the opt-out, keyboard focus still opens the popover", async () => {
    const { user } = setup();
    render(
      <Popover openDelay={OPEN_DELAY} clickInert>
        <PopoverTrigger>
          <button type="button">System row</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>System vitals</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });
});

describe("Popover — pointerInert takes the pointer out of BOTH the open and the close gesture", () => {
  // Mirrors the clickInert block above, from the pointer side: a plain hover does open, and a
  // pointer-leave does close, by default; `pointerInert` suppresses both and nothing else, leaving
  // click and keyboard-focus opens untouched. The alert bar's chips need hover to mean "raise clear
  // of the overlapped stack" instead — and, having opened by click, must not then be dismissed by
  // the pointer moving anywhere that is neither the chip nor the flyout.

  function renderInert() {
    render(
      <Popover openDelay={OPEN_DELAY} pointerInert>
        <PopoverTrigger>
          <button type="button">System row</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>System vitals</p>
        </PopoverContent>
      </Popover>,
    );
  }

  it("without the opt-out, hover opens the popover after openDelay (the behaviour being opted out of)", async () => {
    const { user } = setup();
    renderPopover();
    await user.hover(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("with the opt-out, hover never opens the popover", async () => {
    const { user } = setup();
    renderInert();

    await user.hover(screen.getByRole("button", { name: "System row" }));
    // Waited well past openDelay — confirms this is suppression, not a timing accident.
    await wait(OPEN_DELAY + 60);
    expect(screen.queryByText("System vitals")).not.toBeInTheDocument();
  });

  it("with the opt-out, a click still opens the popover", async () => {
    const { user } = setup();
    renderInert();

    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });

  it("with the opt-out, keyboard focus still opens the popover", async () => {
    const { user } = setup();
    renderInert();

    await user.tab();
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });

  it("with the opt-out, leaving the trigger with the pointer after a click-open does NOT close it", async () => {
    // The asymmetry this pins: a click-open never raises `keyboardInsideRef` (only ArrowDown does),
    // so a close path gated on that flag alone would fire here and dismiss the popover a grace
    // period after the pointer wandered off — leaving a surface that only click and keyboard can
    // open but any pointer movement takes away.
    const { user } = setup();
    renderInert();

    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByText("System vitals")).toBeInTheDocument();

    await user.unhover(screen.getByRole("button", { name: "System row" }));
    // Well past the internal close-grace window, so this is suppression rather than a race with it.
    await wait(300);
    expect(screen.getByText("System vitals")).toBeInTheDocument();
  });

  it("without the opt-out, that same pointer-leave DOES close it", async () => {
    // The control for the test above: the close path is live and reachable by exactly this
    // sequence, so the assertion above is about the opt-out and not about `unhover` doing nothing.
    const { user } = setup();
    renderPopover();

    await user.click(screen.getByRole("button", { name: "System row" }));
    expect(await screen.findByText("System vitals")).toBeInTheDocument();

    await user.unhover(screen.getByRole("button", { name: "System row" }));
    await waitFor(() => expect(screen.queryByText("System vitals")).not.toBeInTheDocument());
  });
});

describe("Popover — a popover that unmounts under the pointer", () => {
  // Tracker rows unmount routinely (the query is invalidated every economy
  // cycle, and rows drop off the funded front as projects finish), often
  // while the cursor is still on them. React fires no `pointerleave` for an
  // element that disappears beneath the cursor, so nothing the trigger's own
  // handlers do can clean up after that — only an unmount effect can.

  function LabeledPopover({ label, openDelay }: { label: string; openDelay: number }) {
    return (
      <Popover openDelay={openDelay}>
        <PopoverTrigger>
          <button type="button">{label}</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Vitals for {label}</p>
        </PopoverContent>
      </Popover>
    );
  }

  it("its pending hover-open never fires and closes a popover opened after it", async () => {
    const { user } = setup();
    // A's delay is deliberately long enough that B can be opened, and read,
    // in the window where A's stale timer is still pending.
    const A_DELAY = 200;
    function Pair({ showA }: { showA: boolean }) {
      return (
        <>
          {showA ? <LabeledPopover label="A" openDelay={A_DELAY} /> : null}
          <LabeledPopover label="B" openDelay={OPEN_DELAY} />
        </>
      );
    }
    const { rerender } = render(<Pair showA />);

    // Hover A — an open is now scheduled for +200ms — then drop the row out
    // of the tree with the pointer still on it, exactly as a tracker refresh
    // does. No unhover: that is the whole point.
    await user.hover(screen.getByRole("button", { name: "A" }));
    rerender(<Pair showA={false} />);

    await user.hover(screen.getByRole("button", { name: "B" }));
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();

    // Past the moment A's open was scheduled for. If that timer survived the
    // unmount it fires now, claims the exclusivity registry for a popover that
    // no longer exists, and shuts B — a popover the user is reading closing with
    // no cause anywhere on screen.
    await wait(A_DELAY + 100);
    expect(screen.getByText("Vitals for B")).toBeInTheDocument();
  });

  it("unmounting after another popover has taken over leaves that popover's claim intact", async () => {
    const { user } = setup();
    // Hover-driven and immediately asserted for the same reasons as the
    // exclusivity test above — an outside click or focus would let Radix
    // close the previous popover by itself and mask the registry entirely.
    function Trio({ showA }: { showA: boolean }) {
      return (
        <>
          {showA ? <LabeledPopover label="A" openDelay={OPEN_DELAY} /> : null}
          <LabeledPopover label="B" openDelay={0} />
          <LabeledPopover label="C" openDelay={0} />
        </>
      );
    }
    const { rerender } = render(<Trio showA />);

    await user.hover(screen.getByRole("button", { name: "A" }));
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: "B" }));
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();
    // B now holds the registry; A gave it up when exclusivity closed it.
    expect(screen.queryByText("Vitals for A")).not.toBeInTheDocument();

    // A — already closed, holding nothing — unmounts. Its cleanup must
    // release the registry only if it still holds it: a popover that blanks the
    // slot unconditionally on its way out wipes B's claim, and C then opens
    // alongside B instead of replacing it.
    rerender(<Trio showA={false} />);

    await user.hover(screen.getByRole("button", { name: "C" }));
    expect(await screen.findByText("Vitals for C")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for B")).not.toBeInTheDocument();
  });
});

describe("Popover — focus bookkeeping survives a close that returns no focus", () => {
  function PopoverWithNeighbour() {
    return (
      <>
        <button type="button">Elsewhere</button>
        <Popover openDelay={OPEN_DELAY}>
          <PopoverTrigger>
            <button type="button">System row</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>System vitals</p>
          </PopoverContent>
        </Popover>
      </>
    );
  }

  it("a keyboard-opened popover dismissed by clicking elsewhere still opens on the next Tab", async () => {
    const { user } = setup();
    render(<PopoverWithNeighbour />);

    // Opened by keyboard, so this is the path where Radix DOES normally
    // hand focus back to the trigger on close, and where the component has
    // to suppress that returned focus to stop the popover reopening itself.
    await user.tab(); // "Elsewhere"
    await user.tab(); // the trigger — opens the popover
    expect(await screen.findByText("System vitals")).toBeInTheDocument();

    // Dismissing by an outside interaction is the one close path where
    // Radix's non-modal Content deliberately does NOT return that focus, so
    // a suppress-the-next-trigger-focus flag raised at close time is never
    // consumed and stays raised.
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => {
      expect(screen.queryByText("System vitals")).not.toBeInTheDocument();
    });
    await wait(20); // Radix dispatches its close-auto-focus on a timeout
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();

    // The next Tab is a genuine keyboard open and must not be swallowed —
    // a stranded flag eats exactly one, so the popover fails to open once and
    // then behaves, which reads as flakiness rather than as a bug.
    await user.tab();
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });

  it("a press that never becomes a click leaves keyboard-open working", async () => {
    const { user } = setup();
    render(<PopoverWithNeighbour />);
    const trigger = screen.getByRole("button", { name: "System row" });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    // Press the row, drag off it, release outside: no click ever fires, so
    // the trigger's click handler — the only thing that used to lower the
    // "this focus came from a mouse press" flag — never runs.
    await user.pointer([
      { keys: "[MouseLeft>]", target: trigger },
      { target: elsewhere },
      { keys: "[/MouseLeft]", target: elsewhere },
    ]);
    expect(screen.queryByText("System vitals")).not.toBeInTheDocument();

    act(() => elsewhere.focus());
    await user.tab();
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });
});

describe("Popover — openDelay guards against a passing pointer", () => {
  it("a pointer that enters and leaves before openDelay elapses never opens the popover", async () => {
    const { user } = setup();
    renderPopover();

    const trigger = screen.getByRole("button", { name: "System row" });
    await user.hover(trigger);
    await user.unhover(trigger); // leaves well before OPEN_DELAY (40ms) with delay:null

    // Wait past what would have been the open moment, then confirm it
    // never appeared.
    await wait(OPEN_DELAY + 60);
    expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
  });
});

describe("Popover — usePopoverDepth", () => {
  function DepthProbe({ label }: { label: string }) {
    const depth = usePopoverDepth();
    return <p>{label} would-be depth {depth}</p>;
  }

  it("reports 0 with no open ancestor and one more than the ancestor's own depth when nested", async () => {
    const { user } = setup();
    render(
      <>
        <DepthProbe label="top-level" />
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <DepthProbe label="inside A" />
          </PopoverContent>
        </Popover>
      </>,
    );

    expect(screen.getByText("top-level would-be depth 0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Row A" }));
    expect(await screen.findByText("inside A would-be depth 1")).toBeInTheDocument();
  });
});

describe("Popover — the exclusivity stack is ancestor-aware, not a single incumbent", () => {
  it("a popover opening at depth 0 while another depth-0 popover is open closes it — today's exclusivity, unchanged", async () => {
    // Mirrors the pre-existing depth-0 exclusivity coverage exactly, as this task's own vacuity
    // check: the stack has to reproduce the single-pointer behaviour before any nested case matters.
    const { user } = setup();
    render(
      <>
        <Popover openDelay={OPEN_DELAY}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for A</p>
          </PopoverContent>
        </Popover>
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row B</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for B</p>
          </PopoverContent>
        </Popover>
      </>,
    );

    await user.hover(screen.getByRole("button", { name: "Row A" }));
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: "Row B" }));
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for A")).not.toBeInTheDocument();
  });

  function NestedPopovers({ withSecondChild = false }: { withSecondChild?: boolean }) {
    return (
      <>
        <button type="button">Elsewhere</button>
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for A</p>
            <Popover openDelay={0}>
              <PopoverTrigger>
                <button type="button">Child A1</button>
              </PopoverTrigger>
              <PopoverContent>
                <p>Vitals for A1</p>
              </PopoverContent>
            </Popover>
            {withSecondChild && (
              <Popover openDelay={0}>
                <PopoverTrigger>
                  <button type="button">Child B1</button>
                </PopoverTrigger>
                <PopoverContent>
                  <p>Vitals for B1</p>
                </PopoverContent>
              </Popover>
            )}
          </PopoverContent>
        </Popover>
      </>
    );
  }

  it("opening a depth-1 popover leaves its depth-0 ancestor open", async () => {
    const { user } = setup();
    render(<NestedPopovers />);

    await user.click(screen.getByRole("button", { name: "Row A" }));
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Child A1" }));
    expect(await screen.findByText("Vitals for A1")).toBeInTheDocument();
    expect(screen.getByText("Vitals for A")).toBeInTheDocument();
  });

  it("a second depth-1 popover opening closes the first depth-1 popover and still leaves depth 0 open", async () => {
    // Hover throughout, not click: clicking Child B1 is a pointerdown outside Child A1's own
    // Radix layer, which Radix would dismiss A1 for on its own — masking whether OUR registry is
    // what closed it. Hover never triggers that outside-dismiss, so a synchronous check right after
    // hovering B1 (well inside A1's own 150ms close grace) attributes the close to the claim alone.
    const { user } = setup();
    render(<NestedPopovers withSecondChild />);

    await user.hover(screen.getByRole("button", { name: "Row A" }));
    await screen.findByText("Vitals for A");
    await user.hover(screen.getByRole("button", { name: "Child A1" }));
    await screen.findByText("Vitals for A1");

    await user.hover(screen.getByRole("button", { name: "Child B1" }));
    expect(await screen.findByText("Vitals for B1")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for A1")).not.toBeInTheDocument();
    expect(screen.getByText("Vitals for A")).toBeInTheDocument();
  });

  it("closing a depth-0 popover closes its depth-1 descendant with it, rather than stranding it", async () => {
    // A1 is deliberately rendered as a SIBLING of A's own PopoverContent — still inside A's
    // Popover, so it still reads A's context and is depth 1 — rather than nested INSIDE A's
    // content the way a real term trigger would be. A depth-1 popover nested in A's content
    // unmounts along with A's content the instant A closes regardless of anything this test
    // exercises (React tearing the tree down, not our registry), which would make "Vitals for A1"
    // disappear either way and mask exactly the cascade this test exists to pin. Keeping A1
    // outside that Presence-controlled subtree means the ONLY thing that can close it is the
    // registry cascade in `releaseOpen`.
    //
    // Hover throughout for the same reason as the test above: A's own pointer-leave grace timer,
    // untouched by any outside pointerdown, is what closes A here — the cascade this pins is then
    // the only thing that could close A1 too.
    const { user } = setup();
    render(
      <Popover openDelay={0}>
        <PopoverTrigger>
          <button type="button">Row A</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Vitals for A</p>
        </PopoverContent>
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Child A1</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for A1</p>
          </PopoverContent>
        </Popover>
      </Popover>,
    );

    await user.hover(screen.getByRole("button", { name: "Row A" }));
    await screen.findByText("Vitals for A");
    await user.hover(screen.getByRole("button", { name: "Child A1" }));
    await screen.findByText("Vitals for A1");

    // No further interaction: Row A's own pointer-leave grace (150ms, fired when the pointer moved
    // onto Child A1 above) is what closes A on its own.
    await waitFor(
      () => {
        expect(screen.queryByText("Vitals for A")).not.toBeInTheDocument();
      },
      { timeout: 1000 },
    );
    expect(screen.queryByText("Vitals for A1")).not.toBeInTheDocument();
  });

  it("a depth-1 popover unmounting under a live pointer releases only its own stack entry, never entries below it", async () => {
    const { user } = setup();
    function Scene({ showA1 }: { showA1: boolean }) {
      return (
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row A</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for A</p>
            {showA1 && (
              <Popover openDelay={0}>
                <PopoverTrigger>
                  <button type="button">Child A1</button>
                </PopoverTrigger>
                <PopoverContent>
                  <p>Vitals for A1</p>
                </PopoverContent>
              </Popover>
            )}
            <Popover openDelay={0}>
              <PopoverTrigger>
                <button type="button">Child B1</button>
              </PopoverTrigger>
              <PopoverContent>
                <p>Vitals for B1</p>
              </PopoverContent>
            </Popover>
          </PopoverContent>
        </Popover>
      );
    }
    const { rerender } = render(
      <>
        <Scene showA1 />
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row C</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for C</p>
          </PopoverContent>
        </Popover>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Row A" }));
    await screen.findByText("Vitals for A");
    await user.click(screen.getByRole("button", { name: "Child A1" }));
    await screen.findByText("Vitals for A1");

    // B1 claims A1's depth-1 slot, closing A1 through the normal claim path — A1 no longer holds
    // any stack entry from here on.
    await user.click(screen.getByRole("button", { name: "Child B1" }));
    expect(await screen.findByText("Vitals for B1")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for A1")).not.toBeInTheDocument();

    // A1's row unmounts entirely, exactly as a Tracker row does under a live pointer, with no
    // proper close in between. Its cleanup releases nothing, because it no longer holds the
    // depth-1 slot — this must not touch A (depth 0, below it) or B1 (the popover that now holds
    // the depth-1 slot A1 used to).
    rerender(
      <>
        <Scene showA1={false} />
        <Popover openDelay={0}>
          <PopoverTrigger>
            <button type="button">Row C</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Vitals for C</p>
          </PopoverContent>
        </Popover>
      </>,
    );
    expect(screen.getByText("Vitals for A")).toBeInTheDocument();
    expect(screen.getByText("Vitals for B1")).toBeInTheDocument();

    // The registry-only assertions above can't tell a correct release apart from one that silently
    // corrupts the whole stack, since neither calls a `close()` — nothing about A's or B1's own
    // React state would change either way. Forcing a fresh depth-0 claim is what makes the
    // registry's actual contents observable: A is still the depth-0 incumbent, so opening C must
    // still close it (and B1 cascades with it), exactly as exclusivity always has.
    await user.click(screen.getByRole("button", { name: "Row C" }));
    expect(await screen.findByText("Vitals for C")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for A")).not.toBeInTheDocument();
    expect(screen.queryByText("Vitals for B1")).not.toBeInTheDocument();
  });

  it("takeover is recorded true for a depth-1 popover closed by a claim at its own depth", async () => {
    // The single-level takeover test already pins that a claimed-over popover must not hand focus
    // back to its own trigger. This generalises it to depth 1: the ancestor (A) stays open
    // throughout, and B1 claims A1's depth-1 slot directly — A's content, and so A1's trigger,
    // stays mounted the whole time, which is what makes the focus outcome observable at all. (If A
    // closed too, A1's trigger would unmount along with it regardless of the takeover flag's value,
    // masking exactly what this test exists to pin — the cascaded case from proof 4 verifies the
    // close itself happens, but not this flag independently, for that same reason.)
    //
    // B1 claims by HOVER, not click or focus: either of those would land outside A1's own Radix
    // layer and dismiss A1 through Radix's own outside-interaction handling before our registry
    // ever runs, the same confound the earlier depth-1 exclusivity test hit.
    const { user } = setup();
    render(
      <Popover openDelay={OPEN_DELAY}>
        <PopoverTrigger>
          <button type="button">Row A</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Vitals for A</p>
          <Popover openDelay={OPEN_DELAY}>
            <PopoverTrigger>
              <button type="button">Child A1</button>
            </PopoverTrigger>
            <PopoverContent>
              <button type="button">Unpin A1</button>
            </PopoverContent>
          </Popover>
          <Popover openDelay={0}>
            <PopoverTrigger>
              <button type="button">Child B1</button>
            </PopoverTrigger>
            <PopoverContent>
              <p>Vitals for B1</p>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Row A" }));
    await screen.findByText("Vitals for A");
    const childA1 = screen.getByRole("button", { name: "Child A1" });
    act(() => childA1.focus());
    await screen.findByRole("button", { name: "Unpin A1" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin A1" })).toHaveFocus();

    await user.hover(screen.getByRole("button", { name: "Child B1" }));
    expect(await screen.findByText("Vitals for B1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpin A1" })).not.toBeInTheDocument();
    expect(childA1).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("Escape on a depth-1 popover records no takeover and returns focus to its own trigger", async () => {
    // The counterpart of the cascade test above: a depth-1 popover closing on its own, not through
    // any claim, still gets the ordinary focus hand-back — depth alone must not read as a takeover.
    const { user } = setup();
    render(
      <Popover openDelay={OPEN_DELAY}>
        <PopoverTrigger>
          <button type="button">Row A</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Vitals for A</p>
          <Popover openDelay={OPEN_DELAY}>
            <PopoverTrigger>
              <button type="button">Child A1</button>
            </PopoverTrigger>
            <PopoverContent>
              <button type="button">Unpin A1</button>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Row A" }));
    await screen.findByText("Vitals for A");
    const childA1 = screen.getByRole("button", { name: "Child A1" });
    act(() => childA1.focus());
    await screen.findByRole("button", { name: "Unpin A1" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin A1" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin A1" })).not.toBeInTheDocument();
    });
    expect(childA1).toHaveFocus();
  });
});
