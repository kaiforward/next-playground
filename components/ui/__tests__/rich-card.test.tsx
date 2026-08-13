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

describe("RichCard — no open path moves focus", () => {
  it("keyboard focus opens the card and leaves focus on the trigger", async () => {
    const { user } = setup();
    renderCard();

    // Tab lands on the trigger (the only tabbable element so far), which
    // opens the card immediately — no openDelay wait. Focus stays put: a
    // card describes the thing its trigger already is, and it is portalled
    // to the end of the document, so a card that took focus here would put
    // every later trigger behind it in tab order.
    await user.tab();
    const trigger = screen.getByRole("button", { name: "System row" });
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("hover opens the card after openDelay without moving focus into it", async () => {
    const { user } = setup();
    renderCard();

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

describe("RichCard — ArrowDown is the way into a card", () => {
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

    await user.tab(); // the trigger — the card opens beside it, focus stays here
    await screen.findByRole("button", { name: "Unpin" });

    // The deliberate way in. Nothing before this press moved focus, so a
    // control in a card is keyboard-operable without a card ever grabbing.
    await user.keyboard("{ArrowDown}");
    const unpinButton = screen.getByRole("button", { name: "Unpin" });
    expect(unpinButton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onUnpin).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown on a closed card opens it and enters it in the one press", async () => {
    const { user } = setup();
    renderCard();
    const trigger = screen.getByRole("button", { name: "System row" });

    // Tab in, Escape out: the card is closed with focus still on the
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

  it("focuses the content itself when the card holds nothing focusable", async () => {
    const { user } = setup();
    render(
      <RichCard openDelay={OPEN_DELAY}>
        <RichCardTrigger>
          <button type="button">System row</button>
        </RichCardTrigger>
        <RichCardContent aria-label="Rigel vitals">
          <p>Stability 82%</p>
        </RichCardContent>
      </RichCard>,
    );

    await user.tab();
    await screen.findByText("Stability 82%");
    await user.keyboard("{ArrowDown}");

    // Nothing inside is focusable, but the card still has to be reachable
    // or a screen reader driven by the keyboard can never be told to read
    // it. Focus lands on the card itself.
    expect(screen.getByRole("dialog", { name: "Rigel vitals" })).toHaveFocus();
  });

  it("consumes the key, so the page does not scroll as well", async () => {
    const { user } = setup();
    // What a scrolling page sees: the press reaches the document either
    // way, and `defaultPrevented` is the only thing telling it this
    // ArrowDown was spent on entering a card. Recorded rather than asserted
    // inside the listener — jsdom swallows a throw from an event handler.
    const prevented: boolean[] = [];
    const record = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") prevented.push(event.defaultPrevented);
    };
    document.addEventListener("keydown", record);
    try {
      renderCard();
      await user.tab();
      await screen.findByRole("button", { name: "Unpin" });
      await user.keyboard("{ArrowDown}");
      expect(prevented).toEqual([true]);
    } finally {
      document.removeEventListener("keydown", record);
    }
  });
});

describe("RichCard — Tab cycles inside an entered card", () => {
  function renderTwoControlCard() {
    render(
      <RichCard openDelay={OPEN_DELAY}>
        <RichCardTrigger>
          <button type="button">System row</button>
        </RichCardTrigger>
        <RichCardContent>
          <button type="button">Unpin</button>
          <button type="button">Show on map</button>
        </RichCardContent>
      </RichCard>,
    );
  }

  it("Tab at the last control wraps to the first, and Shift+Tab at the first wraps to the last", async () => {
    const { user } = setup();
    renderTwoControlCard();

    await user.tab();
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{ArrowDown}");

    const unpin = screen.getByRole("button", { name: "Unpin" });
    const showOnMap = screen.getByRole("button", { name: "Show on map" });
    expect(unpin).toHaveFocus();

    await user.tab();
    expect(showOnMap).toHaveFocus();

    // The card is portalled to the END of the document, so "the next
    // tabbable after the last control" is nothing at all — this wrap is
    // what stops focus falling into that void, and it is why Escape can be
    // the deliberate way out rather than the only escape from a dead end.
    await user.tab();
    expect(unpin).toHaveFocus();

    await user.tab({ shift: true });
    expect(showOnMap).toHaveFocus();
  });
});

describe("RichCard — Escape is the way back out", () => {
  it("from inside the card, closes it and puts focus back on the trigger", async () => {
    const { user } = setup();
    renderCard();
    const trigger = screen.getByRole("button", { name: "System row" });

    await user.tab();
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();

    // Escape is the counterpart of the ArrowDown that entered: it has to
    // land the user back where they came from, not on the document body
    // with the card (and the element that had focus) gone from the DOM.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("a card the pointer opened and the keyboard entered still returns focus to its trigger", async () => {
    const { user } = setup();
    renderCard();
    const trigger = screen.getByRole("button", { name: "System row" });

    // Reaching a pointer-opened card with focus already on its trigger: Tab
    // in, Escape out (focus stays on the trigger, card closed), then the
    // pointer reopens it. The card is now flagged pointer-opened, and a
    // pointer-opened card deliberately suppresses the focus return on close
    // — that suppression is what stops hovering row-to-row killing the card
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

  it("the pointer leaving does not close a card the keyboard is inside", async () => {
    const { user } = setup();
    renderCard();
    const trigger = screen.getByRole("button", { name: "System row" });

    await user.tab();
    await user.hover(trigger);
    await screen.findByRole("button", { name: "Unpin" });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();

    // The user stopped driving with the pointer when they entered. Closing
    // on the grace period now would pull the card out from under a keyboard
    // reader mid-read; Escape is their way out, and only theirs.
    await user.unhover(trigger);
    await wait(300);
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveFocus();
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
        <RichCard openDelay={0}>
          <RichCardTrigger>
            <button type="button">Row B</button>
          </RichCardTrigger>
          <RichCardContent>
            <p>Vitals for B</p>
          </RichCardContent>
        </RichCard>
      </>,
    );

    // Both cards are opened by HOVER, and neither trigger is ever clicked or
    // focused. Both of those would close A through a path of Radix's own —
    // an outside pointerdown, or a focusin outside the layer, each of which
    // dismisses the open popover directly — and A would then vanish whether
    // or not this component's exclusivity ever ran. Hover is the only open
    // path that leaves the first card's fate entirely to the code under
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

  it("the card that took over stays open, and the closed card takes no focus", async () => {
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
        <RichCard openDelay={0}>
          <RichCardTrigger>
            <button type="button">Row B</button>
          </RichCardTrigger>
          <RichCardContent>
            <p>Vitals for B</p>
          </RichCardContent>
        </RichCard>
      </>,
    );

    await user.hover(screen.getByRole("button", { name: "Row A" }));
    expect(await screen.findByText("Vitals for A")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "Row B" }));
    expect(await screen.findByText("Vitals for B")).toBeInTheDocument();

    // Sliding the pointer down a list of rows is the main way this thing is
    // used, so B has to still be there a moment later. A hover-opened card
    // never took focus, so A must not hand any back on its way out: that
    // focus would land on A's trigger, and a focusin outside B's layer is
    // all Radix needs to dismiss B — B would open and vanish in the same
    // frame, and the keyboard caret would silently sit on the row above.
    await wait(200);
    expect(screen.getByText("Vitals for B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Row A" })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
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

describe("RichCard — a card that unmounts under the pointer", () => {
  // Tracker rows unmount routinely (the query is invalidated every economy
  // cycle, and rows drop off the funded front as projects finish), often
  // while the cursor is still on them. React fires no `pointerleave` for an
  // element that disappears beneath the cursor, so nothing the trigger's own
  // handlers do can clean up after that — only an unmount effect can.

  function Card({ label, openDelay }: { label: string; openDelay: number }) {
    return (
      <RichCard openDelay={openDelay}>
        <RichCardTrigger>
          <button type="button">{label}</button>
        </RichCardTrigger>
        <RichCardContent>
          <p>Vitals for {label}</p>
        </RichCardContent>
      </RichCard>
    );
  }

  it("its pending hover-open never fires and closes a card opened after it", async () => {
    const { user } = setup();
    // A's delay is deliberately long enough that B can be opened, and read,
    // in the window where A's stale timer is still pending.
    const A_DELAY = 200;
    function Pair({ showA }: { showA: boolean }) {
      return (
        <>
          {showA ? <Card label="A" openDelay={A_DELAY} /> : null}
          <Card label="B" openDelay={OPEN_DELAY} />
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
    // unmount it fires now, claims the exclusivity registry for a card that
    // no longer exists, and shuts B — a card the user is reading closing with
    // no cause anywhere on screen.
    await wait(A_DELAY + 100);
    expect(screen.getByText("Vitals for B")).toBeInTheDocument();
  });

  it("unmounting after another card has taken over leaves that card's claim intact", async () => {
    const { user } = setup();
    // Hover-driven and immediately asserted for the same reasons as the
    // exclusivity test above — an outside click or focus would let Radix
    // close the previous card by itself and mask the registry entirely.
    function Trio({ showA }: { showA: boolean }) {
      return (
        <>
          {showA ? <Card label="A" openDelay={OPEN_DELAY} /> : null}
          <Card label="B" openDelay={0} />
          <Card label="C" openDelay={0} />
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
    // release the registry only if it still holds it: a card that blanks the
    // slot unconditionally on its way out wipes B's claim, and C then opens
    // alongside B instead of replacing it.
    rerender(<Trio showA={false} />);

    await user.hover(screen.getByRole("button", { name: "C" }));
    expect(await screen.findByText("Vitals for C")).toBeInTheDocument();
    expect(screen.queryByText("Vitals for B")).not.toBeInTheDocument();
  });
});

describe("RichCard — focus bookkeeping survives a close that returns no focus", () => {
  function CardWithNeighbour() {
    return (
      <>
        <button type="button">Elsewhere</button>
        <RichCard openDelay={OPEN_DELAY}>
          <RichCardTrigger>
            <button type="button">System row</button>
          </RichCardTrigger>
          <RichCardContent>
            <p>System vitals</p>
          </RichCardContent>
        </RichCard>
      </>
    );
  }

  it("a keyboard-opened card dismissed by clicking elsewhere still opens on the next Tab", async () => {
    const { user } = setup();
    render(<CardWithNeighbour />);

    // Opened by keyboard, so this is the path where Radix DOES normally
    // hand focus back to the trigger on close, and where the component has
    // to suppress that returned focus to stop the card reopening itself.
    await user.tab(); // "Elsewhere"
    await user.tab(); // the trigger — opens the card
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
    // a stranded flag eats exactly one, so the card fails to open once and
    // then behaves, which reads as flakiness rather than as a bug.
    await user.tab();
    expect(await screen.findByText("System vitals")).toBeInTheDocument();
  });

  it("a press that never becomes a click leaves keyboard-open working", async () => {
    const { user } = setup();
    render(<CardWithNeighbour />);
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
