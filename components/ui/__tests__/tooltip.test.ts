import { describe, expect, test } from "vitest";
import { triggerLabelStyles } from "../tooltip";

/**
 * `triggerLabelStyles` moved from module-private to exported so `TermLabel`
 * (`components/ui/term-label.tsx`) can share it rather than copy it. This is a pure value test,
 * not a rendered-style assertion (AGENTS.md forbids the latter in a component test, since jsdom
 * has no CSS) — it pins the exact class string the `tv()` slot produces, captured before the
 * extraction, so the 17 shipped `TooltipTriggerLabel` triggers this decoration already styles
 * cannot silently drift when something edits it.
 */
describe("triggerLabelStyles", () => {
  test("produces the app-wide dotted-underline affordance, unchanged by the extraction", () => {
    expect(triggerLabelStyles({})).toBe(
      "text-left [text-transform:inherit] underline decoration-dotted decoration-1 decoration-text-tertiary/75 underline-offset-[3px] hover:decoration-solid hover:decoration-text-secondary",
    );
  });
});
