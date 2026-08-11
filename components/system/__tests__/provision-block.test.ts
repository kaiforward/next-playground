import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ProvisionBlock } from "@/components/system/provision-block";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PopNeedData, SystemProvisionRead } from "@/lib/types/api";

// No jsdom in the `unit` project — react-dom/server render on real markup. `needs`-bearing cases
// wrap the tree in the app's own `TooltipProvider` (Radix's Tooltip.Root throws without one; the
// real app mounts it in app/(game)/layout.tsx). Radix's Portal machinery only activates once a
// tooltip is OPEN, which a static render never triggers, so it never reaches for `document`.

const assessed: SystemProvisionRead = {
  assessed: true,
  pct: 68,
  band: "strained",
  expectationPct: 84,
  grievance: 0.16,
};

function need(overrides: Partial<PopNeedData> & { goodId: string; goodName: string; satisfaction: number }): PopNeedData {
  return {
    want: 10,
    delivered: 9,
    pressure: 0.05,
    breakdown: { base: 5, technicians: 3, engineers: 2 },
    ...overrides,
  };
}

function renderWithTooltips(needs: PopNeedData[]) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, ProvisionBlock({ read: assessed, needs })));
}

describe("ProvisionBlock — band chip, percentage, track key, and the absent state", () => {
  it("assessed: renders the band chip, the percentage, and a Now/Used-to key naming both numbers", () => {
    const html = renderToStaticMarkup(ProvisionBlock({ read: assessed, needs: [] }));
    expect(html).toContain("Strained");
    expect(html).toContain(">68%<");
    expect(html).toContain("Now 68%");
    expect(html).toContain("Used to 84%");
    // the design pass's restraint: no band-name labels stamped onto the track's own segments
    expect(html).not.toContain(">Rationing<");
    expect(html).not.toContain(">Supplied<");
  });

  it("the track's two rules sit at the read's own pct/expectationPct positions", () => {
    const html = renderToStaticMarkup(ProvisionBlock({ read: assessed, needs: [] }));
    expect(html).toContain("left:68%");
    expect(html).toContain("left:84%");
  });

  it("unassessed: renders the absent state — no percentage, no crash — with a distinct chip", () => {
    const html = renderToStaticMarkup(ProvisionBlock({ read: { assessed: false }, needs: [] }));
    expect(html).toContain("Not assessed");
    expect(html).toContain("Not yet assessed");
    expect(html).not.toContain("Now ");
    expect(html).not.toContain("Used to");
  });

  it("empty needs renders the ledger's own empty state beneath the block, not a missing section", () => {
    const html = renderToStaticMarkup(ProvisionBlock({ read: assessed, needs: [] }));
    expect(html).toContain("No needs.");
  });

  it("the moved ledger keeps its collapsed met tail and input ordering — a met need is folded behind the expand toggle, and inline problem rows keep the order the service pressure-sorted them in", () => {
    const needs: PopNeedData[] = [
      need({ goodId: "critical-good", goodName: "Critical good", satisfaction: 0.2 }), // critical, highest pressure first
      need({ goodId: "short-good", goodName: "Short good", satisfaction: 0.8 }), // short
      need({ goodId: "met-good", goodName: "Met good", satisfaction: 0.99 }), // met — collapsed
    ];
    const html = renderWithTooltips(needs);
    expect(html).toContain("Critical good");
    expect(html).toContain("Short good");
    // the met good is folded behind the "N needs met" toggle, not rendered as its own row
    expect(html).not.toContain("Met good");
    expect(html).toContain("1 needs met");
    // pressure ordering preserved: the critical row's markup precedes the short row's
    expect(html.indexOf("Critical good")).toBeLessThan(html.indexOf("Short good"));
  });
});
