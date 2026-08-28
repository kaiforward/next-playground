import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DWELL_MS, DWELL_OPEN_DELAY_MS } from "@/components/ui/popover";
import { TermLabel } from "@/components/ui/term-label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTriggerLabel } from "@/components/ui/tooltip";
import { TERMS } from "@/lib/glossary/terms";

// Rendered in jsdom, driven with real user-event pointer sequences and queried by role/accessible
// name — never by class or style, per the component-test convention (AGENTS.md -> Testing). Real
// timers throughout: `dwell` mode's Presence/FocusScope machinery is fragile under fake timers,
// the same reason `components/ui/__tests__/popover.test.tsx` gives for its own dwell suite.

function setup() {
  const user = userEvent.setup({ delay: null });
  return { user };
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Opens a `TermLabel`'s popover by name and waits past the open grace AND the full dwell (the
 *  lock timer starts once the popover actually opens, `DWELL_OPEN_DELAY_MS` after the hover), so
 *  its body is mounted, locked and enterable — the state every test below needs before it can see
 *  what a body rendered. */
async function openTerm(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.hover(screen.getByRole("button", { name }));
  await wait(DWELL_OPEN_DELAY_MS + DWELL_MS + 150);
}

describe("TermLabel", () => {
  it("a body referencing another term renders a working trigger, so a chain is possible", async () => {
    const { user } = setup();
    render(<TermLabel id="resourceSlot" />);

    await openTerm(user, "Resource slot");

    // `resourceSlot`'s definition names `body` and `resource`, each twice — every occurrence
    // becomes its own working trigger, reachable inside the open dialog by the label the segment
    // carries. Scoped to the dialog and asserted by accessible name, not by counting every
    // `<button>` in it — a count is also true of any unrelated control (the pin button included)
    // that happens to render beside the body, which is not what this test means.
    const dialog = screen.getByRole("dialog", { name: "Resource slot" });
    expect(await within(dialog).findAllByRole("button", { name: "body" })).toHaveLength(2);
    expect(within(dialog).getAllByRole("button", { name: "resource" })).toHaveLength(2);
  });

  it("a body referencing no term renders a leaf that opens nothing further", async () => {
    const { user } = setup();
    render(<TermLabel id="worked" />);

    await openTerm(user, "Worked");

    const dialog = await screen.findByRole("dialog", { name: "Worked" });
    // The leaf body's own text carries no term reference, so none of the glossary's term names —
    // enumerated from the data, not hardcoded — should be reachable as a trigger inside it. Asserted
    // by name so an unrelated control (the pin button, named "Pin") can never make this fail; only a
    // trigger for an actual term would.
    for (const { term } of Object.values(TERMS)) {
      expect(within(dialog).queryByRole("button", { name: term })).not.toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent(
      "Marks the slots a system's built extractor levels are on, best ground first.",
    );
  });

  it("a term whose body references itself through another term opens without recursing at render time", async () => {
    const { user } = setup();
    render(<TermLabel id="family" />);

    // `family` names `specialisation complex`, which names `family` back — a real cycle. Opening
    // the outer term must terminate: only the immediate level renders, so the reference back to
    // `family` inside `specialisation complex`'s own (still-unopened) body is just another
    // trigger, not a second copy of `family`'s own definition rendered inline.
    await openTerm(user, "Family");
    const familyDialog = await screen.findByRole("dialog", { name: "Family" });
    expect(familyDialog).toHaveTextContent("Each has its own");
    expect(screen.getByRole("button", { name: "specialisation complex" })).toBeInTheDocument();

    // Following the cycle one more level — into the term that names `family` back — also
    // terminates, and does not re-render `family`'s own definition text a second time anywhere
    // in the document.
    await openTerm(user, "specialisation complex");
    const complexDialog = await screen.findByRole("dialog", { name: "Specialisation complex" });
    expect(complexDialog).toHaveTextContent("A system may hold one complex, of one");
    expect(
      screen.getAllByText(
        "One of the five groups the processed and advanced goods fall into: heavy industry, chemicals, electronics, armaments and consumer.",
        { exact: false },
      ),
    ).toHaveLength(1);
  });

  it("is distinguishable from TooltipTriggerLabel: it opens an enterable dialog region, not a description", async () => {
    // Radix's `Tooltip.Arrow` needs `ResizeObserver`, which jsdom doesn't provide — stubbed here,
    // same convention as `components/panels/__tests__/system-astrography.test.tsx`.
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);

    const { user } = setup();
    render(
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTriggerLabel>Plain control help</TooltipTriggerLabel>
            <TooltipContent>Supplemental legend text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TermLabel id="worked" />
      </>,
    );

    // TooltipTriggerLabel's content is a description announced with the control — not a separate
    // focusable region a person can enter. No `dialog` role exists for it at all.
    await user.hover(screen.getByRole("button", { name: "Plain control help" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Supplemental legend text");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.unhover(screen.getByRole("button", { name: "Plain control help" }));

    // TermLabel's content is a real `dialog` region with its own accessible name, reachable and
    // readable independently of the trigger — the tier `theme.md` assigns it.
    await openTerm(user, "Worked");
    expect(screen.getByRole("dialog", { name: "Worked" })).toBeInTheDocument();
  });
});
