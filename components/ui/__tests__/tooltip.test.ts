import { describe, expect, test } from "vitest";
import { triggerLabelStyles } from "../tooltip";

/**
 * `triggerLabelStyles` is exported so `PopoverTriggerLabel` (`components/ui/popover-trigger-label.tsx`)
 * and `TermLabel` (`components/ui/term-label.tsx`) share this one definition of the dotted-grey
 * affordance rather than each copying it. This is a pure value test, not a rendered-style
 * assertion (AGENTS.md forbids the latter in a component test, since jsdom has no CSS) — it pins
 * the exact class string the `tv()` slot produces so it cannot silently drift when something
 * edits it.
 */
describe("triggerLabelStyles", () => {
  test("produces the app-wide dotted-underline affordance, unchanged by the extraction", () => {
    expect(triggerLabelStyles({})).toBe(
      "text-left [text-transform:inherit] underline decoration-dotted decoration-1 decoration-text-tertiary/75 underline-offset-[3px] hover:decoration-solid hover:decoration-text-secondary",
    );
  });
});
