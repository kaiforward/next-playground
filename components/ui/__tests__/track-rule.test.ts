import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackRule } from "@/components/ui/track-rule";

// No jsdom in the `unit` project — render to a static HTML string and assert on the real markup.

describe("TrackRule — a positioned rule shared by the Provisioned and Stability tracks", () => {
  it("sits at its own percentage, solid by default, painting the colour it was given", () => {
    const html = renderToStaticMarkup(TrackRule({ pct: 68, color: "var(--color-text-primary)" }));
    expect(html).toContain("left:68%");
    expect(html).toContain("background-color:var(--color-text-primary)");
    expect(html).not.toContain("border-dashed");
  });

  it("dashed paints its LEFT BORDER, not a background — a zero-width span whose border is the mark", () => {
    const html = renderToStaticMarkup(
      TrackRule({ pct: 84, color: "var(--color-text-secondary)", dashed: true }),
    );
    expect(html).toContain("left:84%");
    expect(html).toContain("border-dashed");
    expect(html).toContain("border-color:var(--color-text-secondary)");
    expect(html).not.toContain("background-color");
  });

  it("clamps out of range, so a rule can never escape the track it marks", () => {
    expect(renderToStaticMarkup(TrackRule({ pct: 137, color: "red" }))).toContain("left:100%");
    expect(renderToStaticMarkup(TrackRule({ pct: -12, color: "red" }))).toContain("left:0%");
  });

  it("opposite overhangs keep two rules at the SAME position legible as two marks", () => {
    const up = renderToStaticMarkup(TrackRule({ pct: 35, color: "red", dashed: true, overhang: "up" }));
    const down = renderToStaticMarkup(TrackRule({ pct: 35, color: "red", overhang: "down" }));
    expect(up).toContain("-top-1.5 bottom-0");
    expect(up).not.toContain("-bottom-1.5");
    expect(down).toContain("top-0 -bottom-1.5");
    expect(down).not.toContain("-top-1.5");
    // Same position, so only the geometry can separate them.
    expect(up).toContain("left:35%");
    expect(down).toContain("left:35%");
  });

  it("defaults to an even overhang — the Provisioned track's shipped geometry", () => {
    const html = renderToStaticMarkup(TrackRule({ pct: 20, color: "red" }));
    expect(html).toContain("-top-0.5 -bottom-0.5");
  });
});
