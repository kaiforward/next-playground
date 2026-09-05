import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  DWELL_MS,
  DWELL_OPEN_DELAY_MS,
  LEAVE_GRACE_MS,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RETURN_GRACE_MS,
  usePopoverDepth,
} from "@/components/ui/popover";

// Rendered in jsdom, driven with user-event (real pointer/keyboard event
// sequences, not fire-and-hope) and queried by role/accessible name/focus —
// never by class or style, per the component-test convention. A true
// pointer-transit *geometry* test (does the physical path between trigger
// and content matter) is not something jsdom can honestly answer — it has
// no layout — so the transit test below exercises the time-based grace
// period the implementation actually uses instead. Placement and hit-testing
// stay unprovable here: they need a real browser.

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

// A linear dwell chain built from `labels`, each level nested inside the previous one's content —
// exactly the shape a real TermLabel chain takes. `aria-label` on each level's content is what lets
// a test disambiguate "the Pin button inside THIS dialog" once more than one chain is open at once,
// and what lets a test read a specific dialog's own inline `opacity` style.
function buildChain(labels: readonly string[]): ReactNode {
  const [label, ...rest] = labels;
  if (!label) return null;
  return (
    <Popover dwell key={label}>
      <PopoverTrigger>
        <button type="button">{label}</button>
      </PopoverTrigger>
      <PopoverContent aria-label={`Definition ${label}`}>
        <p>Definition {label}</p>
        {rest.length > 0 && buildChain(rest)}
      </PopoverContent>
    </Popover>
  );
}

// Hovers `triggerName` and waits past the open grace and the dwell, so the popover it belongs to is
// `locked` by the time this resolves.
async function openLocked(user: ReturnType<typeof userEvent.setup>, triggerName: string) {
  await user.hover(screen.getByRole("button", { name: triggerName }));
  await wait(DWELL_OPEN_DELAY_MS + DWELL_MS + 80);
}

function dialogFor(label: string): HTMLElement {
  return screen.getByRole("dialog", { name: `Definition ${label}` });
}

// A plain DOM click rather than `user.click` deliberately: the pointer's own transit toward the Pin
// button (leaving whatever was hovered before it) is a real pointer-leave in its own right —
// exercised on purpose by its own test below — and is not what this helper exists to drive.
//
// `label` must name the chain's DEEPEST currently-open level — the pin/unpin control renders only
// there (it follows the pointer down as the chain grows), not at every open ancestor.
// `pointerDown` before the click, and it is load-bearing rather than ceremony: Radix's
// `DismissableLayer` detects an outside interaction from `pointerdown`, never from `click`. A
// `fireEvent.click` alone therefore never asks any OTHER open popover whether this click dismisses
// it — which is exactly the question a second pin has to survive, and it silently passed for a
// build in which pinning a second chain destroyed the first.
function pin(label: string) {
  const pinButton = within(dialogFor(label)).getByRole("button", { name: "Pin" });
  fireEvent.pointerDown(pinButton);
  fireEvent.click(pinButton);
}

// Same DOM-click rationale as `pin` above, for the same reason: `label` names the chain's deepest
// currently-open (and now pinned) level, where the toggle now reads "Unpin".
function unpin(label: string) {
  const unpinButton = within(dialogFor(label)).getByRole("button", { name: "Unpin" });
  fireEvent.pointerDown(unpinButton);
  fireEvent.click(unpinButton);
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
    // Mirrors the plain depth-0 exclusivity coverage exactly: the stack has to reproduce the
    // single-incumbent behaviour before any nested case matters.
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

describe("Popover — dwell mode", () => {
  // Real timers throughout, per this file's own header comment — Radix's FocusScope/Presence
  // machinery is fragile under fake timers, and `dwell` mode still renders through
  // `PopoverPrimitive.Content`. `DWELL_OPEN_DELAY_MS` and `DWELL_MS` are fixed module constants
  // (not props — the mode is tuned as a unit), so these waits are the real durations rather than a
  // shortened test double.
  //
  // "Does not receive the pointer" / "receives the pointer" (entries 2 and 3) are asserted via
  // `@testing-library/user-event`'s own pointer-events check: by default (`PointerEventsCheckLevel
  // .EachApiCall`) it reads the element's *computed* `pointer-events` — inherited from the content
  // element's own inline style, which is real DOM state our code sets, not a Tailwind class that
  // depends on a stylesheet jsdom never loads — and refuses to dispatch the interaction, throwing
  // rather than silently no-op'ing. That is the actual browser-observable difference a
  // `pointer-events: none` element makes: a real pointer over it hits whatever is behind it
  // instead. What this can't honestly show is *which* element the browser reports underneath —
  // that needs real hit-test geometry jsdom does not have, the same limitation this file's header
  // comment already names for pointer-transit.
  function renderDwellPopover(onNestedClick?: () => void) {
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Term</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" onClick={onNestedClick}>
            Nested control
          </button>
        </PopoverContent>
      </Popover>,
    );
  }

  it("a pointer that enters and leaves faster than the open grace opens nothing", async () => {
    const { user } = setup();
    renderDwellPopover();
    const trigger = screen.getByRole("button", { name: "Term" });

    await user.hover(trigger);
    await user.unhover(trigger); // leaves well before DWELL_OPEN_DELAY_MS with delay:null

    // Checked immediately, not only after a long wait: an implementation that opened synchronously
    // (skipping the grace entirely) and only closed later on the ordinary pointer-leave grace would
    // still read "absent" by the time a long wait elapses, masking exactly the bug this pins.
    expect(screen.queryByRole("button", { name: "Nested control" })).not.toBeInTheDocument();

    await wait(DWELL_OPEN_DELAY_MS + 100);
    expect(screen.queryByRole("button", { name: "Nested control" })).not.toBeInTheDocument();
  });

  it("a popover in filling does not receive the pointer", async () => {
    const { user } = setup();
    renderDwellPopover();

    await user.hover(screen.getByRole("button", { name: "Term" }));
    const nested = await screen.findByRole("button", { name: "Nested control" });

    // Well inside DWELL_MS — still filling.
    await expect(user.click(nested)).rejects.toThrow(/pointer-events: none/);
  });

  it("a popover reaching locked receives the pointer and holds its position when the cursor moves on", async () => {
    // A separate render from the "does not receive the pointer" case above, deliberately: a click
    // user-event rejects for the pointer-events check still moves its virtual pointer through the
    // trigger on the way to the target, which schedules the ordinary hover-leave close — mixing
    // that into this test would make it a close-grace test wearing this one's name.
    const { user } = setup();
    const onNestedClick = vi.fn();
    renderDwellPopover(onNestedClick);

    await user.hover(screen.getByRole("button", { name: "Term" }));
    const nested = await screen.findByRole("button", { name: "Nested control" });

    // Past DWELL_MS: locked, and a real pointer now reaches it.
    await wait(DWELL_MS + 50);
    await user.click(nested);
    expect(onNestedClick).toHaveBeenCalledTimes(1);

    // The cursor moving on afterwards (simulated here, since the content no longer follows once
    // locked) must not tear the popover down or leave it unclickable — "stops following" means the
    // position freezes, not that the popover breaks.
    await act(async () => {
      document.dispatchEvent(
        new window.PointerEvent("pointermove", { clientX: 999, clientY: 999, bubbles: true }),
      );
    });
    await user.click(nested);
    expect(onNestedClick).toHaveBeenCalledTimes(2);
  });

  it("leaving the trigger before dwell completes closes the popover and no locked state is ever reached", async () => {
    const { user } = setup();
    renderDwellPopover();
    const trigger = screen.getByRole("button", { name: "Term" });

    await user.hover(trigger);
    await screen.findByRole("button", { name: "Nested control" });

    // Still filling — leave well before DWELL_MS elapses.
    await user.unhover(trigger);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Nested control" })).not.toBeInTheDocument();
    });

    // Past the moment DWELL_MS would have elapsed had the popover survived — a stray lock timer
    // that outlived the close would show up here as the content reappearing or the registry
    // getting corrupted; neither happens.
    await wait(DWELL_MS);
    expect(screen.queryByRole("button", { name: "Nested control" })).not.toBeInTheDocument();
  });

  it("without dwell set, opens on the existing 300ms delay, never enters either state, and renders no bar", async () => {
    const { user } = setup();
    const onClick = vi.fn();
    render(
      <Popover>
        <PopoverTrigger>
          <button type="button">Row</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" onClick={onClick}>
            Vitals
          </button>
        </PopoverContent>
      </Popover>,
    );

    await user.hover(screen.getByRole("button", { name: "Row" }));
    // Not yet — the default 300ms hover-open delay hasn't elapsed (no openDelay override, so this
    // is the real regression arm for the five existing consumers, all of which rely on the default).
    await wait(150);
    expect(screen.queryByRole("button", { name: "Vitals" })).not.toBeInTheDocument();

    const vitals = await screen.findByRole("button", { name: "Vitals" }, { timeout: 500 });

    // No bar — only a `dwell` popover sets an inline transition-duration on a fill element; a
    // plain popover's content carries no such style anywhere in its subtree.
    expect(document.querySelector('[style*="transition-duration"]')).toBeNull();

    // Pointer events were never touched: the click reaches it immediately, no throw.
    await user.click(vitals);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe("the lock arrives at the same instant the bar's own declared duration promises", () => {
    // `DwellBar`'s fill duration lives only in its inline `transitionDuration` style — real DOM
    // state the component itself sets, not a bespoke test attribute, and readable in jsdom without
    // any stylesheet (`el.style.transitionDuration`). Reading it back, rather than importing
    // `DWELL_MS` and feeding it into the wait below, is what makes these tests fail if the LOCK
    // timer alone drifts from what the bar promises: entries 1/3/4 above already pin the lock
    // arriving at `DWELL_MS`, but none of them ever look at the bar, so a second literal hardcoded
    // on the lock timer alone (leaving the bar at `DWELL_MS`) is invisible to all three.
    //
    // Two separate renders, not one interaction sequence, for the same reason as the "reaching
    // locked" test above: a click user-event rejects for the pointer-events check still moves its
    // virtual pointer through the trigger, which schedules the ordinary hover-leave close — mixing
    // that into a single test would make the second assertion a close-grace test wearing this
    // one's name.
    async function openAndReadBarDuration(onNestedClick?: () => void) {
      renderDwellPopover(onNestedClick);
      const user = userEvent.setup({ delay: null });
      await user.hover(screen.getByRole("button", { name: "Term" }));
      const nested = await screen.findByRole("button", { name: "Nested control" });
      const dialog = nested.closest('[role="dialog"]');
      const bar = dialog?.querySelector<HTMLElement>('div[style*="transition-duration"]');
      if (!bar) throw new Error("expected the dwell bar to be present while filling");
      const durationMs = Number.parseInt(bar.style.transitionDuration, 10);
      return { user, nested, durationMs };
    }

    it("still refuses the pointer just before the bar's declared duration elapses", async () => {
      const { user, nested, durationMs } = await openAndReadBarDuration();

      await wait(durationMs - 100);
      await expect(user.click(nested)).rejects.toThrow(/pointer-events: none/);
    });

    it("accepts the pointer once the bar's declared duration has elapsed", async () => {
      const onNestedClick = vi.fn();
      const { user, nested, durationMs } = await openAndReadBarDuration(onNestedClick);

      await wait(durationMs + 100);
      await user.click(nested);
      expect(onNestedClick).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Popover — the dwell stack lifecycle (return grace, leave grace, depth cue)", () => {
  // Real timers throughout, per this file's own header comment — Radix's
  // FocusScope/Presence machinery is fragile under fake timers, and a locked `dwell` popover still
  // renders through `PopoverPrimitive.Content`. `RETURN_GRACE_MS` (140) and `LEAVE_GRACE_MS` (90) are
  // real fixed module constants, so the waits below are the real durations.
  //
  // A two-level real dwell chain: term A's popover contains term A1's own trigger, so reaching A1's
  // popover from A1's trigger genuinely crosses A's content in the DOM the way the spec describes —
  // A1's trigger is a descendant of A's content, and A1's own content is a SEPARATE portalled
  // element overlapping it on screen, exactly as two real chained TermLabels would be.
  function renderChain() {
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Term A</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Definition A</p>
          <Popover dwell>
            <PopoverTrigger>
              <button type="button">Term A1</button>
            </PopoverTrigger>
            <PopoverContent>
              <p>Definition A1</p>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );
  }

  it("moving from a term to its own child popover does not close that child, though the path crosses the parent", async () => {
    const { user } = setup();
    renderChain();

    await openLocked(user, "Term A");
    expect(await screen.findByText("Definition A")).toBeInTheDocument();
    await openLocked(user, "Term A1");
    expect(await screen.findByText("Definition A1")).toBeInTheDocument();
    // A first genuine visit to the child's own content, so the return trip below is a real
    // re-entry of the parent rather than a first-ever arrival.
    await user.hover(screen.getByText("Definition A1"));

    // The trip back for another look at the child crosses the parent's body on the way — resting
    // briefly on A (genuinely re-entering its content, having just been on A1's) before reaching
    // A1 again. This is the transit the return grace exists to survive: reach the child again
    // before the grace elapses and it must still be there.
    await user.hover(screen.getByText("Definition A"));
    await user.hover(screen.getByText("Definition A1"));

    await wait(RETURN_GRACE_MS + 150);
    expect(screen.getByText("Definition A1")).toBeInTheDocument();
    expect(screen.getByText("Definition A")).toBeInTheDocument();
  });

  it("resting on a parent for longer than the return grace does close its children", async () => {
    const { user } = setup();
    renderChain();

    await openLocked(user, "Term A");
    await openLocked(user, "Term A1");
    await user.hover(screen.getByText("Definition A1"));
    expect(screen.getByText("Definition A1")).toBeInTheDocument();

    // Away from the child and onto the parent's own content, deliberately not moving again — this
    // is "resting", not transit.
    await user.hover(screen.getByText("Definition A"));

    await waitFor(
      () => {
        expect(screen.queryByText("Definition A1")).not.toBeInTheDocument();
      },
      { timeout: RETURN_GRACE_MS + 500 },
    );
    expect(screen.getByText("Definition A")).toBeInTheDocument();
  });

  it("a late leave of the child's own trigger, arriving after the parent's content was already entered, closes only the child — not the whole stack", async () => {
    // The child's TRIGGER (`renderChain`'s "Term A1" button) sits inside the PARENT's content, so a
    // real return trip from the child back to the parent plausibly leaves the child trigger's own
    // bounds a beat AFTER already having entered the parent's content, not before — `user.hover`'s
    // scripted jumps never produce that ordering (it only fires enter/leave on its own target), so
    // this dispatches the two events directly, in that order, to pin the ordering itself.
    //
    // The leave carries a `relatedTarget` inside the parent's content because that is what a real
    // pointer moving there carries, and React's enter/leave dispatch reads it: it fires leave only
    // up to the common ancestor of where the pointer was and where it went. Without one, React
    // treats the pointer as having left the document and fires a leave on the PARENT's content too
    // — a departure the browser never reports for this gesture, and one that says the pointer is
    // off the whole stack when it is resting in the middle of it.
    //
    // Before the fix, this closed the WHOLE stack: the parent's `onPointerEnter` cancelled the
    // pending whole-stack leave grace and armed the (correct) return grace targeting the child, but
    // the child trigger's `onPointerLeave` — arriving after — unconditionally re-armed the
    // whole-stack grace with nothing left to cancel it, and `LEAVE_GRACE_MS` (90) is shorter than
    // `RETURN_GRACE_MS` (140), so the whole-stack close fired first and took the parent with it.
    const { user } = setup();
    renderChain();

    await openLocked(user, "Term A");
    await openLocked(user, "Term A1");

    fireEvent.pointerEnter(screen.getByText("Definition A"));
    fireEvent.pointerLeave(screen.getByRole("button", { name: "Term A1" }), { relatedTarget: screen.getByText("Definition A") });

    await wait(Math.max(RETURN_GRACE_MS, LEAVE_GRACE_MS) + 150);
    // The parent survives — the bug this pins.
    expect(screen.getByText("Definition A")).toBeInTheDocument();
    // The child still closes on schedule — the return grace this fix must not break: resting on a
    // parent for longer than `RETURN_GRACE_MS` closes what's deeper than it, exactly as the
    // "resting on a parent" test above already covers for a clean (non-racing) hover sequence.
    expect(screen.queryByText("Definition A1")).not.toBeInTheDocument();
  });

  it("re-entering a child within the return grace cancels the pending close", async () => {
    const { user } = setup();
    renderChain();

    await openLocked(user, "Term A");
    await openLocked(user, "Term A1");
    await user.hover(screen.getByText("Definition A1"));

    // Rest on the parent long enough to schedule the child's close, but return to the child before
    // the grace elapses.
    await user.hover(screen.getByText("Definition A"));
    await wait(RETURN_GRACE_MS - 70);
    await user.hover(screen.getByText("Definition A1"));

    // Past the moment the original close would have fired, had it not been cancelled.
    await wait(RETURN_GRACE_MS);
    expect(screen.getByText("Definition A1")).toBeInTheDocument();
  });

  it("leaving the whole stack closes every depth, not only the top", async () => {
    const { user } = setup();
    renderChain();

    await openLocked(user, "Term A");
    await openLocked(user, "Term A1");
    await user.hover(screen.getByText("Definition A1"));

    // Off the entire stack — nowhere else is hovered.
    await user.unhover(screen.getByText("Definition A1"));

    await waitFor(() => {
      expect(screen.queryByText("Definition A1")).not.toBeInTheDocument();
    });
    // The parent, not only the child that was actually under the pointer, is also gone.
    expect(screen.queryByText("Definition A")).not.toBeInTheDocument();
  });

  it("re-entering any popover within the leave grace cancels the pending dismissal of all of them", async () => {
    const { user } = setup();
    renderChain();

    await openLocked(user, "Term A");
    await openLocked(user, "Term A1");
    await user.hover(screen.getByText("Definition A1"));

    await user.unhover(screen.getByText("Definition A1"));
    await wait(LEAVE_GRACE_MS - 40);
    // Reaching back into the stack — the parent's own content, not the child that was left —
    // before the leave grace elapses.
    await user.hover(screen.getByText("Definition A"));

    // Comfortably past the leave grace's original mark (~40ms after resuming) and comfortably short
    // of the fresh return grace that re-entering the parent itself schedules (RETURN_GRACE_MS further
    // out from here), so this reads the leave-dismissal outcome specifically.
    await wait(80);
    expect(screen.getByText("Definition A")).toBeInTheDocument();
    expect(screen.getByText("Definition A1")).toBeInTheDocument();
  });

  it("hovering a separate, standalone plain popover's trigger never cancels another chain's pending leave grace", async () => {
    // `markRegionEntered` — the only thing that cancels a pending whole-stack leave grace — is
    // gated on `popover.dwell` at both call sites (`PopoverTrigger`'s and `PopoverContent`'s
    // pointer-enter). A plain (non-`dwell`) popover's own trigger must never call it. Nesting the
    // plain popover inside the dwell one to test this doesn't work: the plain trigger would then
    // be a real DOM descendant of the dwell content, so physically reaching it always genuinely
    // re-enters the dwell content first too — there is no event that reaches a NESTED trigger
    // without also, correctly, re-arming its ancestor. Two separate, sibling popovers sidesteps
    // that: hovering one's trigger never crosses the other's bounds at all.
    //
    // The plain popover's own `openDelay` is set far longer than this test's window so it never
    // itself opens and claims a stack slot — hovering its trigger, without it ever opening, is
    // the only thing under test.
    const { user } = setup();
    render(
      <>
        <Popover dwell>
          <PopoverTrigger>
            <button type="button">Term A</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Definition A</p>
          </PopoverContent>
        </Popover>
        <Popover openDelay={5000}>
          <PopoverTrigger>
            <button type="button">Plain row</button>
          </PopoverTrigger>
          <PopoverContent>
            <p>Plain vitals</p>
          </PopoverContent>
        </Popover>
      </>,
    );

    await openLocked(user, "Term A");
    await user.hover(screen.getByText("Definition A"));
    // Off the entire stack — arms the whole-stack leave grace.
    await user.unhover(screen.getByText("Definition A"));

    await wait(LEAVE_GRACE_MS - 40);
    // A completely unrelated, standalone plain popover's own trigger, well inside the leave grace.
    await user.hover(screen.getByRole("button", { name: "Plain row" }));

    // Past the leave grace's original mark: Term A closes on schedule, undisturbed by the pointer
    // now resting on the unrelated plain popover's trigger.
    await waitFor(() => {
      expect(screen.queryByText("Definition A")).not.toBeInTheDocument();
    });
  });
});

describe("Popover — a dwell popover nested inside a non-dwell, click-opened ancestor", () => {
  // The bug this pins: `scheduleLeaveClose` used to run `closeFromDepth(-1)` — the
  // close-everything sentinel — unconditionally once `stackHoverCount` reached zero.
  // `stackHoverCount` is only ever incremented by a `dwell` popover's own regions
  // (`PopoverTrigger`/`PopoverContent` gate `markRegionEntered`/`markRegionLeft` on
  // `popover.dwell`), so a non-`dwell` ancestor never contributes to the count at all — leaving a
  // nested dwell chain (a `TermLabel` inside the alert flyout, `components/alerts/alert-flyout.tsx`,
  // or inside the settings panel, `components/alerts/alert-settings.tsx`) always drove the count to
  // zero and closed that ancestor right along with the chain, however far from the leave grace's
  // business it was. The fix closes only from the shallowest open `dwell` entry down
  // (`firstDwellIndex`), leaving a click-opened ancestor below it untouched.
  function renderClickAncestorWithDwellChild() {
    render(
      <Popover openDelay={0}>
        <PopoverTrigger>
          <button type="button">Flyout trigger</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Flyout">
          <p>Flyout body</p>
          <Popover dwell>
            <PopoverTrigger>
              <button type="button">Term</button>
            </PopoverTrigger>
            <PopoverContent aria-label="Term card">
              <p>Term definition</p>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );
  }

  it("leaving the term closes it but leaves the click-opened ancestor open", async () => {
    const { user } = setup();
    renderClickAncestorWithDwellChild();

    await user.click(screen.getByRole("button", { name: "Flyout trigger" }));
    const flyout = await screen.findByRole("dialog", { name: "Flyout" });

    await openLocked(user, "Term");
    expect(screen.getByRole("dialog", { name: "Term card" })).toBeInTheDocument();

    // Off the term's trigger entirely, onto the ancestor's own body — not the term's trigger and
    // not its content, so this is a genuine leave of the whole (one-level) dwell chain while the
    // click-opened ancestor is still very much under the pointer.
    await user.hover(screen.getByText("Flyout body"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Term card" })).not.toBeInTheDocument();
    });
    expect(flyout).toBeInTheDocument();
  });
});

describe("Popover — keyboard access in the dwell mode", () => {
  // Real timers throughout, per this file's own header comment and Tasks 2/3's own precedent.

  function renderDwellPopover(onNestedClick?: () => void) {
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Term</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" onClick={onNestedClick}>
            Nested control
          </button>
        </PopoverContent>
      </Popover>,
    );
  }

  it("Enter on a term trigger opens its popover already locked and enterable, with no dwell elapsed", async () => {
    const { user } = setup();
    const onNestedClick = vi.fn();
    renderDwellPopover(onNestedClick);
    const trigger = screen.getByRole("button", { name: "Term" });

    // No hover, no wait — a bare Enter keydown dispatched straight to the (unfocused) trigger, so
    // nothing but the Enter handling itself can be responsible for what happens next.
    fireEvent.keyDown(trigger, { key: "Enter" });
    const nested = await screen.findByRole("button", { name: "Nested control" });

    // Clicked immediately, with no wait at all: if the dwell were still running (the ordinary
    // hover path takes DWELL_MS before this succeeds — see the "dwell mode" describe block above),
    // this click would reject with the same "pointer-events: none" error asserted there. A test
    // that instead awaited something first could pass even with the dwell still in effect, which
    // is exactly what this immediacy is pinned against.
    await user.click(nested);
    expect(onNestedClick).toHaveBeenCalledTimes(1);
  });

  it("Enter also finishes an already-filling popover's dwell early, rather than waiting it out", async () => {
    // The other half of the "already open" branch `openViaFocus` takes: reaching a term whose
    // popover a stray hover already put into `filling` (not yet `locked`).
    const { user } = setup();
    const onNestedClick = vi.fn();
    renderDwellPopover(onNestedClick);
    const trigger = screen.getByRole("button", { name: "Term" });

    await user.hover(trigger);
    const nested = await screen.findByRole("button", { name: "Nested control" });
    // Still filling — confirm the ordinary guard is live before forcing it early, or a broken
    // Enter path could look like it worked while actually racing a dwell that was about to finish
    // on its own.
    await expect(user.click(nested)).rejects.toThrow(/pointer-events: none/);

    fireEvent.keyDown(trigger, { key: "Enter" });
    await user.click(nested);
    expect(onNestedClick).toHaveBeenCalledTimes(1);
  });

  it("a keyboard-opened popover anchors to its trigger, not to wherever the pointer happens to be", async () => {
    renderDwellPopover();
    const trigger = screen.getByRole("button", { name: "Term" });

    // Record a real, distinguishing pointer position first — a hover that never opens the popover
    // (unhovered well inside the open grace), leaving `dwellPointerRef` non-null so a broken
    // implementation that still ran the cursor-anchored path would have something real to place
    // itself at, rather than silently no-op'ing on a null ref and passing either way.
    fireEvent.pointerEnter(trigger, { clientX: 500, clientY: 500 });
    fireEvent.pointerLeave(trigger);

    fireEvent.keyDown(trigger, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");

    // Placement is Radix's own now, off a virtual cursor `Anchor` `Popover` mounts only for a
    // pointer-driven open (`cursorAnchored` in `popover.tsx`) — jsdom has no layout, so the
    // resulting pixels can't be asserted, but which anchor
    // mode is live is a real decision this component makes and records on the content element
    // itself (`data-dwell-anchor`), not a value derived from layout. A keyboard open never sets
    // `cursorAnchored`, so the virtual anchor is never even mounted and the content keeps Radix's
    // own default of anchoring the popper to the trigger instead.
    expect(dialog).toHaveAttribute("data-dwell-anchor", "trigger");
  });

  it("Escape with a three-deep stack closes only the innermost, and a second Escape closes the next — each returning focus to its own trigger", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Term A</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Definition A</p>
          <Popover dwell>
            <PopoverTrigger>
              <button type="button">Term A1</button>
            </PopoverTrigger>
            <PopoverContent>
              <p>Definition A1</p>
              <Popover dwell>
                <PopoverTrigger>
                  <button type="button">Term A2</button>
                </PopoverTrigger>
                <PopoverContent>
                  <p>Definition A2</p>
                </PopoverContent>
              </Popover>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );

    // Tab lands on Term A and opens it already locked — the existing `openViaFocus` path this
    // task extends — then ArrowDown enters its content and reaches Term A1.
    await user.tab();
    await screen.findByText("Definition A");
    await user.keyboard("{ArrowDown}");
    const termA1 = screen.getByRole("button", { name: "Term A1" });
    expect(termA1).toHaveFocus();

    // Enter opens A1's popover locked, skipping the dwell it would otherwise run.
    await user.keyboard("{Enter}");
    await screen.findByText("Definition A1");
    await user.keyboard("{ArrowDown}");
    const termA2 = screen.getByRole("button", { name: "Term A2" });
    expect(termA2).toHaveFocus();

    await user.keyboard("{Enter}");
    await screen.findByText("Definition A2");
    await user.keyboard("{ArrowDown}");

    // First Escape: closes only the innermost (A2). A and A1 both survive it.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Definition A2")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Definition A1")).toBeInTheDocument();
    expect(screen.getByText("Definition A")).toBeInTheDocument();
    expect(termA2).toHaveFocus();

    // Second Escape: closes A1 — the next one up, not a jump straight to the outermost — and
    // hands focus to A1's own trigger, not A's.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Definition A1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Definition A")).toBeInTheDocument();
    expect(termA1).toHaveFocus();
  });

  it("a popover the pointer opened and the keyboard then entered still closes when the pointer leaves", async () => {
    // The dwell counterpart of the non-dwell case at the top of this file ("the pointer leaving
    // does not close a popover the keyboard is inside") — and deliberately the OPPOSITE outcome:
    // a dwell popover's leave-close governs the whole stack regardless of `keyboardInsideRef` (see
    // the docblock's "dwell stack's own lifecycle" bullet). This task's keyboard-open changes must
    // not blur that distinction by making the leave-close respect the flag too.
    const { user } = setup();
    const onNestedClick = vi.fn();
    renderDwellPopover(onNestedClick);
    const trigger = screen.getByRole("button", { name: "Term" });

    await user.hover(trigger);
    const nested = await screen.findByRole("button", { name: "Nested control" });
    await wait(DWELL_MS + 50); // locked

    act(() => trigger.focus());
    await user.keyboard("{ArrowDown}");
    expect(nested).toHaveFocus();

    await user.unhover(trigger);
    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: "Nested control" })).not.toBeInTheDocument();
      },
      { timeout: LEAVE_GRACE_MS + 500 },
    );
  });
});

describe("Popover — pinning a chain", () => {
  // Real timers throughout, per this file's own header comment and every prior dwell-mode task's
  // own precedent.

  function DepthProbe({ label }: { label: string }) {
    const depth = usePopoverDepth();
    return <p>{label} would-be depth {depth}</p>;
  }

  it("a pinned chain survives the pointer leaving it entirely", async () => {
    const { user } = setup();
    render(buildChain(["Survive0", "Survive1"]));

    await openLocked(user, "Survive0");
    await openLocked(user, "Survive1");
    // The pin control renders only at the deepest open level — it follows the pointer down as the
    // chain grows, so Survive1 (not the ancestor Survive0) is where it lives once both are open.
    pin("Survive1");

    // Off the entire stack — nowhere else is hovered. Without pinning this is exactly the sequence
    // the "leaving the whole stack closes every depth" test (above) fires the leave grace from.
    await user.unhover(screen.getByText("Definition Survive1"));
    await wait(LEAVE_GRACE_MS + 200);

    expect(screen.getByText("Definition Survive0")).toBeInTheDocument();
    expect(screen.getByText("Definition Survive1")).toBeInTheDocument();
  });

  it("a term inside a pinned popover opens at depth 0, leaving the pinned chain untouched", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Depth0</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Definition Depth0">
          <p>Definition Depth0</p>
          {/* A direct child of Depth0's own content — a term sitting right where a real
             TermLabel would, not nested inside a further popover of its own — so its
             `usePopoverDepth()` reads Depth0's ambient context exactly as a real term's
             `Popover` does when it computes its OWN depth. */}
          <DepthProbe label="sibling term" />
          <Popover dwell>
            <PopoverTrigger>
              <button type="button">Depth0Child</button>
            </PopoverTrigger>
            <PopoverContent aria-label="Definition Depth0Child">
              <p>Definition Depth0Child</p>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );

    await openLocked(user, "Depth0");
    pin("Depth0");

    // A term sitting directly inside the now-pinned content reports depth 0 rather than one more
    // than Depth0's own (which was 0, and would otherwise make this 1).
    expect(await screen.findByText("sibling term would-be depth 0")).toBeInTheDocument();

    // And a REAL popover opened from inside the pinned content — not only a depth probe — behaves
    // as depth 0 too: opening it does not disturb the pinned parent.
    await openLocked(user, "Depth0Child");
    expect(await screen.findByText("Definition Depth0Child")).toBeInTheDocument();
    expect(screen.getByText("Definition Depth0")).toBeInTheDocument();
  });

  it("a fresh chain opened after pinning does not close the pinned one, at any depth", async () => {
    const { user } = setup();
    render(
      <>
        {buildChain(["Fresh0", "Fresh1"])}
        {buildChain(["FreshNew"])}
      </>,
    );

    await openLocked(user, "Fresh0");
    await openLocked(user, "Fresh1");
    // Deepest open level — see the "pin control renders only at the deepest level" comment above.
    pin("Fresh1");

    // A brand new depth-0 chain, opened only after the first one is pinned and so no longer holds
    // depth 0 in the registry.
    await openLocked(user, "FreshNew");

    expect(screen.getByText("Definition Fresh0")).toBeInTheDocument();
    expect(screen.getByText("Definition Fresh1")).toBeInTheDocument();
    expect(screen.getByText("Definition FreshNew")).toBeInTheDocument();
  });

  it("a pinned chain holds full opacity while an unpinned stack beside it fades by depth", async () => {
    const { user } = setup();
    // Four deep each — one past FULL_OPACITY_DEPTH (3) — so the outermost level of a live,
    // unpinned four-deep chain reads the faded (0.5) tier once the whole chain is open.
    render(
      <>
        {buildChain(["Op0", "Op1", "Op2", "Op3"])}
        {buildChain(["Oq0", "Oq1", "Oq2", "Oq3"])}
      </>,
    );

    await openLocked(user, "Op0");
    await openLocked(user, "Op1");
    await openLocked(user, "Op2");
    await openLocked(user, "Op3");
    // Deepest open level — see the "pin control renders only at the deepest level" comment above.
    pin("Op3");

    // Only opened — and so only occupying the registry — once the first chain is pinned and clear
    // of it, exactly as the previous proof's own sequencing requires.
    await openLocked(user, "Oq0");
    await openLocked(user, "Oq1");
    await openLocked(user, "Oq2");
    await openLocked(user, "Oq3");

    expect(dialogFor("Op0").style.opacity).toBe("1");
    expect(dialogFor("Oq0").style.opacity).toBe("0.5");
  });

  it("dismissing a pinned chain does not corrupt a fresh chain's registry entries", async () => {
    // Not a proof that the unmount cleanup's own `releaseOpen` call is necessary FOR the pinned
    // chain — it isn't: pinning already removed Ghost0/Ghost1 from `openStack` at pin time, so by
    // the time they unmount there is nothing left there for them to release. What this pins instead
    // is the failure mode a naive "detach on pin" implementation invites: wiping the WHOLE registry
    // on a pinned popover's unmount, rather than only its own (already-absent) entry, would take a
    // completely unrelated, still-live chain down with it.
    function Scene({ showPinned }: { showPinned: boolean }) {
      return (
        <>
          {showPinned && buildChain(["Ghost0", "Ghost1"])}
          {buildChain(["GhostQ"])}
          {buildChain(["GhostS"])}
        </>
      );
    }
    const { user } = setup();
    const { rerender } = render(<Scene showPinned />);

    await openLocked(user, "Ghost0");
    await openLocked(user, "Ghost1");
    // Deepest open level — see the "pin control renders only at the deepest level" comment above.
    pin("Ghost1");

    // Q claims depth 0 legitimately, once the pinned chain is clear of the registry.
    await openLocked(user, "GhostQ");

    // The pinned chain is dismissed entirely — unmounted, exactly as it would be were its own root
    // popover closed while nested inside a parent whose content just closed.
    rerender(<Scene showPinned={false} />);
    expect(screen.getByText("Definition GhostQ")).toBeInTheDocument();

    // A THIRD, unrelated popover claims depth 0. Ordinary exclusivity says this must close Q — if
    // the pinned chain's dismissal had instead wiped Q's own (unrelated) registry entry as a side
    // effect, Q would be an orphan by now: still visible, but no longer registered, so S opening
    // would never close it and both would show at once.
    await openLocked(user, "GhostS");

    expect(screen.queryByText("Definition GhostQ")).not.toBeInTheDocument();
    expect(screen.getByText("Definition GhostS")).toBeInTheDocument();
  });

  it("dismissing a pinned chain does not cancel a pending return-grace belonging to a live unpinned chain", async () => {
    // `returnCloseTimer`/`leaveCloseTimer` are shared module state, and a popover's unmount clears
    // both. Since a pinned chain and a fresh unpinned chain can be live together, the pinned
    // chain's dismissal must not be able to silently cancel a grace belonging to the other,
    // still-live chain.
    function Scene({ showPinned }: { showPinned: boolean }) {
      return (
        <>
          {showPinned && buildChain(["Precond0", "Precond1"])}
          {buildChain(["Live0", "Live1"])}
        </>
      );
    }
    const { user } = setup();
    const { rerender } = render(<Scene showPinned />);

    await openLocked(user, "Precond0");
    await openLocked(user, "Precond1");
    // Deepest open level — see the "pin control renders only at the deepest level" comment above.
    pin("Precond1");

    // The live, unpinned chain — opened only once the pinned one is clear of the registry.
    await openLocked(user, "Live0");
    await openLocked(user, "Live1");

    // Resting on Live0 (the parent) while Live1 (the child) is open schedules Live1's return-close
    // after RETURN_GRACE_MS — the same sequence the stack-lifecycle describe block above uses to
    // pin that behaviour on its own.
    await user.hover(screen.getByText("Definition Live0"));

    // Well inside the pending grace: dismiss the pinned chain now, exercising the unmount cleanup
    // this precondition is about.
    await wait(RETURN_GRACE_MS / 2);
    rerender(<Scene showPinned={false} />);

    // Past the moment Live1's own return-close was scheduled for. It must still fire — undisturbed
    // by the pinned chain's dismissal — closing Live1 (the child) while leaving Live0 (the parent)
    // open, exactly as the plain (no concurrent pinned chain) version of this behaviour does.
    await waitFor(
      () => {
        expect(screen.queryByText("Definition Live1")).not.toBeInTheDocument();
      },
      { timeout: RETURN_GRACE_MS + 500 },
    );
    expect(screen.getByText("Definition Live0")).toBeInTheDocument();
  });

  it("an unpinned popover unmounting without closing releases its own registry slot", async () => {
    // The Tracker-row-drops-out case the unmount cleanup's own comment names: a still-open,
    // never-pinned popover disappearing from the tree without ever passing through `setOpen(false)`
    // (a `Popover` unmounting is exactly that — no close branch runs, only the cleanup effect).
    // `releaseOpen(closeSelf)` there is what shrinks `openStack` back down; without it the vanished
    // level's slot lingers, so a still-open ANCESTOR keeps reading a stack one level taller than
    // what is actually on screen.
    function Scene({ depth }: { depth: number }) {
      return buildChain(["Un0", "Un1", "Un2", "Un3"].slice(0, depth));
    }
    const { user } = setup();
    const { rerender } = render(<Scene depth={4} />);

    await openLocked(user, "Un0");
    await openLocked(user, "Un1");
    await openLocked(user, "Un2");
    await openLocked(user, "Un3");

    // Four deep, all live: the root already reads the faded tier, the same boundary the sibling
    // "fades by depth" proof above pins.
    expect(dialogFor("Un0").style.opacity).toBe("0.5");

    // Un3 — the deepest, still open — vanishes without closing. Un0..Un2 keep their keys and stay
    // mounted, exactly as a list dropping only its last row would.
    rerender(<Scene depth={3} />);

    // A released slot puts the root back within the full-opacity band; a leaked one leaves the
    // stack believing a fourth level is still live and the root stays faded.
    await waitFor(() => {
      expect(dialogFor("Un0").style.opacity).toBe("1");
    });
  });

  it("the pin control is reachable and operable by its accessible name, not by its glyph", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Reachable</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Definition Reachable">
          <p>Definition Reachable</p>
        </PopoverContent>
      </Popover>,
    );

    // Tab opens a dwell popover already locked (the existing `openViaFocus` path). The pin is
    // chrome (the header), not body content, so ArrowDown's scoped query — which only ever
    // searches `[data-popover-body]` — finds nothing in this content-free body and falls back to
    // the content container itself; a further Tab is what reaches the pin, the only tabbable thing
    // anywhere in the popover.
    await user.tab();
    await screen.findByText("Definition Reachable");
    await user.keyboard("{ArrowDown}");
    await user.tab();

    const pinButton = screen.getByRole("button", { name: "Pin" });
    expect(pinButton).toHaveFocus();

    // Activated by keyboard, found only by its accessible name — never by a class, a test id or the
    // glyph it renders. A working pin turns the SAME control into an "Unpin" toggle rather than
    // removing it — the button stays so a pinned chain can be released from the same place,
    // without falling back to Escape — so both halves of that toggle are the operable proof
    // here: "Pin" is gone, "Unpin" has taken its place, and focus is still on the same element.
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
    });
    const unpinButton = screen.getByRole("button", { name: "Unpin" });
    expect(unpinButton).toHaveFocus();
    expect(unpinButton).toHaveAttribute("aria-pressed", "true");
  });

  it("the pin control is a toggle: activating Unpin reattaches the chain and aria-pressed follows it", async () => {
    const { user } = setup();
    render(buildChain(["Toggle0", "Toggle1"]));

    await openLocked(user, "Toggle0");
    await openLocked(user, "Toggle1");

    // Deepest open level — see the "pin control renders only at the deepest level" comment above.
    const pinnedButton = within(dialogFor("Toggle1")).getByRole("button", { name: "Pin" });
    expect(pinnedButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pinnedButton);

    const unpinButton = within(dialogFor("Toggle1")).getByRole("button", { name: "Unpin" });
    expect(unpinButton).toHaveAttribute("aria-pressed", "true");
    // Still nothing named "Pin" anywhere in this chain — it is the SAME control, renamed, not a
    // second one appearing alongside it.
    expect(within(dialogFor("Toggle1")).queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();

    // Unpin from the same place: the control flips straight back, no Escape involved.
    fireEvent.click(unpinButton);
    await waitFor(() => {
      expect(within(dialogFor("Toggle1")).getByRole("button", { name: "Pin" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(screen.getByText("Definition Toggle0")).toBeInTheDocument();
    expect(screen.getByText("Definition Toggle1")).toBeInTheDocument();
  });

  it("unpinning restores the chain: it survives an unrelated hover, then closes normally once the pointer truly leaves", async () => {
    // Pinning drops this chain's share of `stackHoverCount`, and nothing re-primes it via a real
    // `pointerenter` on unpin — the pointer never crosses a boundary, it was already resting on the
    // content the Unpin button lives in. Unless unpinning recomputes that share from where the
    // pointer actually is, the leave grace below would never arm and this chain would never close
    // on its own again.
    const { user } = setup();
    render(
      <>
        {buildChain(["Restore0", "Restore1"])}
        {buildChain(["RestoreRival"])}
      </>,
    );

    await openLocked(user, "Restore0");
    await openLocked(user, "Restore1");
    pin("Restore1");
    unpin("Restore1");

    // Confirms the chain is genuinely back on the live registry, not merely still visible: the
    // fresh chain here claims depth 0 and — being a live rival, not one this test's own chain still
    // holds — must close it, exactly as ordinary (never-pinned) exclusivity would.
    await openLocked(user, "RestoreRival");
    await waitFor(() => {
      expect(screen.queryByText("Definition Restore0")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Definition RestoreRival")).toBeInTheDocument();
  });

  it("pinning a second chain leaves the first pinned chain with its own working Unpin", async () => {
    // Two chains pinned at once is the point of pinning, not an edge case: the whole reason to pin
    // is to keep something while opening another thing beside it. Each chain must keep its own
    // identity, so each Unpin reattaches the chain it belongs to — a single "most recently pinned"
    // slot leaves the first chain rendering an Unpin that reattaches the SECOND one, and no way out
    // of the first but Escape.
    const { user } = setup();
    render(
      <>
        {buildChain(["Two0", "Two1"])}
        {buildChain(["TwoB0"])}
      </>,
    );

    await openLocked(user, "Two0");
    await openLocked(user, "Two1");
    pin("Two1");

    await openLocked(user, "TwoB0");
    await user.click(within(dialogFor("TwoB0")).getByRole("button", { name: "Pin" }));

    // Both chains are still up, and each shows its OWN Unpin at its own deepest level.
    expect(screen.getByText("Definition Two0")).toBeInTheDocument();
    expect(within(dialogFor("Two1")).getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    expect(within(dialogFor("TwoB0")).getByRole("button", { name: "Unpin" })).toBeInTheDocument();

    // Unpinning the FIRST chain reattaches that chain — the control flips back to Pin there — and
    // leaves the second chain pinned, still showing its own Unpin.
    unpin("Two1");
    await waitFor(() => {
      expect(within(dialogFor("Two1")).getByRole("button", { name: "Pin" })).toBeInTheDocument();
    });
    expect(within(dialogFor("TwoB0")).getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    expect(screen.getByText("Definition TwoB0")).toBeInTheDocument();
  });

  it("a pinned chain still dismisses on a click landing outside every popover", async () => {
    // The other half of the rule above, and the half that decides which rule this is. A pinned
    // popover ignores an interaction inside ANOTHER popover — that is what lets a second chain be
    // pinned. It must not generalise to ignoring interactions altogether: clicking the page itself
    // is how everything else in the app is dismissed, and a pinned popover that survived it would
    // be a thing on screen with no way off it but a control the player has to find, or Escape.
    const { user } = setup();
    render(
      <>
        <button type="button">Elsewhere</button>
        {buildChain(["Bg0"])}
      </>,
    );

    await openLocked(user, "Bg0");
    pin("Bg0");
    expect(within(dialogFor("Bg0")).getByRole("button", { name: "Unpin" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    await waitFor(() => {
      expect(screen.queryByText("Definition Bg0")).not.toBeInTheDocument();
    });
  });

  it("dismissing only the deepest level of a pinned chain hands the unpin control to the level above", async () => {
    // Escape dismisses the highest Radix layer alone, so a pinned chain can lose its deepest level
    // while the rest of it stays on screen. The control has to follow: frozen at the instant of
    // pinning, it disappears with the level that carried it and the surviving levels float with no
    // way to unpin them at all — Escape works, but the affordance is gone.
    const { user } = setup();
    render(buildChain(["Hand0", "Hand1"]));

    await openLocked(user, "Hand0");
    await openLocked(user, "Hand1");
    pin("Hand1");
    expect(within(dialogFor("Hand0")).queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Definition Hand1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Definition Hand0")).toBeInTheDocument();

    // The surviving level inherits the control — and it still unpins its own chain from there.
    await waitFor(() => {
      expect(within(dialogFor("Hand0")).getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    });
    unpin("Hand0");
    await waitFor(() => {
      expect(within(dialogFor("Hand0")).getByRole("button", { name: "Pin" })).toBeInTheDocument();
    });
  });

  it("unpinning by keyboard with the pointer elsewhere leaves later chains still closing on pointer-leave", async () => {
    // Unpinning restores this popover's share of the shared hover count. Restoring a share captured
    // at pin time is wrong for the keyboard path: the control is deliberately keyboard-operable, and
    // between pinning and unpinning the pointer can leave entirely. A restored-anyway share is never
    // given back — the count never reaches zero again, and no dwell popover ANYWHERE in the app
    // closes on pointer-leave for the rest of the session.
    const { user } = setup();
    render(
      <>
        {buildChain(["Key0"])}
        {buildChain(["KeyLater"])}
      </>,
    );

    // Opened by POINTER, so the trigger genuinely holds a share at the moment of pinning.
    await openLocked(user, "Key0");
    act(() => screen.getByRole("button", { name: "Key0" }).focus());
    await user.keyboard("{ArrowDown}");
    await user.tab();
    const pinButton = screen.getByRole("button", { name: "Pin" });
    expect(pinButton).toHaveFocus();
    await user.keyboard("{Enter}");

    // The pointer leaves the trigger entirely while the chain is pinned, so by the time it is
    // unpinned there is nothing left anywhere for it to hold.
    await user.unhover(screen.getByRole("button", { name: "Key0" }));
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
    });

    // A completely separate chain, opened afterwards, must still close when the pointer leaves it.
    await openLocked(user, "KeyLater");
    await user.hover(screen.getByText("Definition KeyLater"));
    await user.unhover(screen.getByText("Definition KeyLater"));
    await waitFor(
      () => {
        expect(screen.queryByText("Definition KeyLater")).not.toBeInTheDocument();
      },
      { timeout: LEAVE_GRACE_MS + 500 },
    );
  });

  it("unpinning restores the leave grace: leaving the reattached chain entirely closes it", async () => {
    const { user } = setup();
    render(buildChain(["Grace0", "Grace1"]));

    await openLocked(user, "Grace0");
    await openLocked(user, "Grace1");
    pin("Grace1");
    unpin("Grace1");

    // Off the entire (now reattached) stack — nowhere else is hovered.
    await user.unhover(screen.getByText("Definition Grace1"));
    await waitFor(
      () => {
        expect(screen.queryByText("Definition Grace0")).not.toBeInTheDocument();
      },
      { timeout: LEAVE_GRACE_MS + 500 },
    );
    expect(screen.queryByText("Definition Grace1")).not.toBeInTheDocument();
  });

  it("a header's own title never displaces ArrowDown's target — a nested term trigger still gets it first", async () => {
    // The header region is structural now (rendered by `PopoverContent` itself, in ORDINARY
    // document order, BEFORE `{children}`) rather than a `PopoverHeader` a body opts into. Its
    // presence — and its own DOM position ahead of the body — must still never change which
    // element `focusIntoContent`/ArrowDown reaches: the nested trigger, never the header's title
    // or the pin nested inside it. That guarantee no longer rests on DOM order at all (see
    // `FOCUSABLE_IN_POPOVER_BODY`'s own comment) — this test is what proves it holds regardless.
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Headered</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Definition Headered" title="A Title">
          <Popover dwell>
            <PopoverTrigger>
              <button type="button">Nested term</button>
            </PopoverTrigger>
            <PopoverContent aria-label="Definition Nested">
              <p>Definition Nested</p>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    await screen.findByText("A Title");
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("button", { name: "Nested term" })).toHaveFocus();
  });

  it("the header region renders for every dwell popover, with the pin control reserved on its right even without a title", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Untitled</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Definition Untitled">
          <p>Definition Untitled</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    await screen.findByText("Definition Untitled");

    // No title was given, but the header's own pin control still renders — the region exists
    // structurally whether or not a title was supplied.
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("a title given to a dwell popover renders inside its header", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Titled</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Definition Titled" title="The Heading">
          <p>Definition Titled</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    await screen.findByText("Definition Titled");

    expect(screen.getByText("The Heading")).toBeInTheDocument();
  });

  it("ArrowDown reaches a nested term trigger over the header's own pin control, and Shift+Tab from there reaches the pin", async () => {
    // The header (with its pin control, since Tab opens this popover already locked and it is the
    // only thing currently open) sits BEFORE `{children}` in plain document order now — no
    // `absolute` positioning, no CSS `order`. What keeps ArrowDown from landing on the pin is the
    // scoped `[data-popover-body]` query, not DOM order; what keeps the pin still reachable by
    // keyboard is Radix's own `FocusScope` in `loop` mode, which tabs (and shift-tabs) across the
    // WHOLE popover, header included — so one Shift+Tab back from the body's own control reaches it.
    //
    // The body control is a plain button rather than a genuine nested `Popover` trigger
    // deliberately: a real nested term trigger auto-opens ITS OWN popover the instant it receives
    // focus (`PopoverTrigger`'s own `onFocus` — see the docblock's keyboard convention), which
    // immediately displaces this popover's pin with the nested one's own (only the deepest open
    // level ever shows one). That cascade is real and covered elsewhere; it would only obscure what
    // this test is actually pinning — that the header/pin sits outside `focusIntoContent`'s scoped
    // search, in ordinary DOM order, reachable by Tab regardless.
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Parent</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Definition Parent" title="A Title">
          <button type="button">Nested control</button>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    await screen.findByText("A Title");
    await screen.findByRole("button", { name: "Pin" });

    await user.keyboard("{ArrowDown}");
    const nestedControl = screen.getByRole("button", { name: "Nested control" });
    expect(nestedControl).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Pin" })).toHaveFocus();
  });
});

describe("Popover — a region that vanishes gives its hover contribution back", () => {
  // The whole-stack leave grace only ever arms on the shared hover count reaching zero, and that
  // count is module-level: one popover that never gives its share back does not merely misbehave
  // itself, it stops every dwell popover in the app from ever closing on pointer-leave again. So
  // each of these opens a chain, does something that removes a tracked region without any
  // pointer-leave to report it, and then proves a LATER, unrelated chain still closes normally.

  it("Escape with the pointer resting in the content leaves later chains still closing on pointer-leave", async () => {
    // Radix's `Presence` unmounts the content while the popover's root stays mounted, and no
    // `pointerleave` is dispatched for an element removed from under a stationary cursor — so the
    // content's own share has to be released by the content going away, not by an event.
    const { user } = setup();
    render(
      <>
        {buildChain(["Esc0"])}
        {buildChain(["EscLater"])}
      </>,
    );

    await openLocked(user, "Esc0");
    // Into the content, and then not another pointer movement of any kind.
    await user.hover(screen.getByText("Definition Esc0"));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("Definition Esc0")).not.toBeInTheDocument();
    });

    // A fresh chain, opened afterwards, still closes when the pointer leaves it.
    await openLocked(user, "EscLater");
    await user.hover(screen.getByText("Definition EscLater"));
    await user.unhover(screen.getByText("Definition EscLater"));
    await waitFor(
      () => {
        expect(screen.queryByText("Definition EscLater")).not.toBeInTheDocument();
      },
      { timeout: LEAVE_GRACE_MS + 500 },
    );
  });

  it("a popover taken over while the pointer rests in its content leaves later chains still closing", async () => {
    // The same removal without a `pointerleave`, reached without the keyboard: Tab onto another
    // dwell trigger opens it, which closes the incumbent at that depth and unmounts its content
    // under the pointer.
    const { user } = setup();
    render(
      <>
        {buildChain(["Over0"])}
        {buildChain(["OverRival"])}
        {buildChain(["OverLater"])}
      </>,
    );

    await openLocked(user, "Over0");
    await user.hover(screen.getByText("Definition Over0"));
    // Focus (not the pointer) reaches the rival's trigger, which opens it and takes depth 0.
    act(() => screen.getByRole("button", { name: "OverRival" }).focus());
    await waitFor(() => {
      expect(screen.queryByText("Definition Over0")).not.toBeInTheDocument();
    });

    await openLocked(user, "OverLater");
    await user.hover(screen.getByText("Definition OverLater"));
    await user.unhover(screen.getByText("Definition OverLater"));
    await waitFor(
      () => {
        expect(screen.queryByText("Definition OverLater")).not.toBeInTheDocument();
      },
      { timeout: LEAVE_GRACE_MS + 500 },
    );
  });

  it("a plain popover unmounting mid-grace does not cancel a dwell chain's pending close", async () => {
    // The return and leave graces are module-level timers, and a non-`dwell` popover never
    // schedules either one — it closes on its own private grace instead. So its unmount must not
    // clear them: an alert chip's popover dropping out when its run's count hits zero on a tick, or
    // a Tracker row leaving the list, would otherwise cancel a pending whole-stack close, and since
    // that grace only arms on the transition to zero, nothing would ever re-arm it.
    function Scene({ showPlain }: { showPlain: boolean }) {
      return (
        <>
          {buildChain(["Plain0"])}
          {showPlain && (
            <Popover>
              <PopoverTrigger>
                <button type="button">Plain row</button>
              </PopoverTrigger>
              <PopoverContent>
                <p>Plain vitals</p>
              </PopoverContent>
            </Popover>
          )}
        </>
      );
    }
    const { user } = setup();
    const { rerender } = render(<Scene showPlain />);

    await openLocked(user, "Plain0");
    await user.hover(screen.getByText("Definition Plain0"));
    // Off the stack entirely — the whole-stack leave grace is now pending.
    await user.unhover(screen.getByText("Definition Plain0"));
    // And the unrelated plain popover disappears inside that window.
    rerender(<Scene showPlain={false} />);

    await waitFor(
      () => {
        expect(screen.queryByText("Definition Plain0")).not.toBeInTheDocument();
      },
      { timeout: LEAVE_GRACE_MS + 500 },
    );
  });
});

describe("Popover — the dialog carries a name", () => {
  // `role="dialog"` gets no accessible name from anywhere on its own, and a screen reader
  // announcing an unnamed dialog tells the reader only that one opened. `PopoverContent` decides
  // this centrally so no call site has to remember to.

  it("names the dialog after the header title it was given", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Yield cell</button>
        </PopoverTrigger>
        <PopoverContent title="Combined yield">
          <p>Worked average across all bodies.</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    expect(await screen.findByRole("dialog", { name: "Combined yield" })).toBeInTheDocument();
  });

  it("names an untitled dialog after the trigger that opened it", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Habitability</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Growth multiplier and fill order.</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    expect(await screen.findByRole("dialog", { name: "Habitability" })).toBeInTheDocument();
  });

  it("leaves a name the call site supplied itself alone", async () => {
    const { user } = setup();
    render(
      <Popover dwell>
        <PopoverTrigger>
          <button type="button">Own name trigger</button>
        </PopoverTrigger>
        <PopoverContent aria-label="Its own name" title="A Title">
          <p>Body</p>
        </PopoverContent>
      </Popover>,
    );

    await user.tab();
    expect(await screen.findByRole("dialog", { name: "Its own name" })).toBeInTheDocument();
  });
});
