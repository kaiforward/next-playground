import { act, screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { DWELL_MS, DWELL_OPEN_DELAY_MS } from "@/components/ui/popover";

/**
 * Shared by every converted panel's test suite (`system-astrography`, `industry-panel`,
 * `population-panel`, `provision-block`, `logistics-panel`): the wait past a `dwell` popover's
 * open grace and its dwell timer, so it is `locked` by the time this resolves. Real timers
 * throughout, matching `components/ui/__tests__/popover.test.tsx`'s own convention — Radix's
 * FocusScope/Presence machinery is fragile under fake timers. The `+80` margin absorbs jsdom's
 * own timer jitter.
 */
export async function waitForDwellLock(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, DWELL_OPEN_DELAY_MS + DWELL_MS + 80));
  });
}

/** Hovers `element` and waits for its `dwell` popover to lock. */
export async function hoverUntilLocked(
  user: ReturnType<typeof userEvent.setup>,
  element: Element,
): Promise<void> {
  await user.hover(element);
  await waitForDwellLock();
}

/** The common case: a trigger that is a plain button, found by its accessible name. */
export async function openLocked(
  user: ReturnType<typeof userEvent.setup>,
  triggerName: string | RegExp,
): Promise<void> {
  await hoverUntilLocked(user, screen.getByRole("button", { name: triggerName }));
}
