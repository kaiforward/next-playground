import { describe, it, expect } from "vitest";
import { cloneElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompositionBar, GhostVitalTile, VitalGrid, VitalTile } from "@/components/ui/vital-tile";

// No jsdom in the `unit` project, so render to a static HTML string with
// react-dom/server (pure node, no DOM) and assert on the real markup — this
// catches mis-threaded props and a non-rendering meter, which `isValidElement`
// alone cannot.

describe("VitalTile — the three concrete Overview tiles render their real output", () => {
  it("Stability: value + unit + a cyan meter filled to 82% with progressbar a11y", () => {
    const html = renderToStaticMarkup(
      VitalTile({
        label: "Stability",
        dotColor: "#06b6d4",
        value: "82",
        unit: "%",
        meter: { pct: 82, color: "#06b6d4" },
        hint: "unrest 0.18",
      }),
    );
    expect(html).toContain("Stability");
    expect(html).toContain(">82<"); // large value, isolated from the unit span
    expect(html).toContain(">%<"); // unit
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="82"');
    expect(html).toContain("width:82%"); // meter fill width threaded through
    expect(html).toContain("background:#06b6d4"); // meter + dot color threaded through
    expect(html).toContain("unrest 0.18"); // hint
  });

  it("Development: copper meter filled to 41%", () => {
    const html = renderToStaticMarkup(
      VitalTile({
        label: "Development",
        dotColor: "var(--color-accent)",
        value: "41",
        unit: "%",
        meter: { pct: 41, color: "var(--color-accent)" },
        hint: "118 pts · room to grow",
      }),
    );
    expect(html).toContain("Development");
    expect(html).toContain(">41<");
    expect(html).toContain("width:41%");
    expect(html).toContain('aria-valuenow="41"');
    expect(html).toContain("118 pts · room to grow");
  });

  it("Population: value + a CompositionBar child, and NO meter (no progressbar role)", () => {
    const html = renderToStaticMarkup(
      VitalTile({
        label: "Population",
        dotColor: "var(--color-status-blue)",
        value: "2.42",
        unit: "M",
        children: CompositionBar({
          segments: [
            { label: "Unsk", value: 61, color: "var(--color-status-blue)" },
            { label: "Tech", value: 22, color: "var(--color-status-cyan)" },
            { label: "Eng", value: 9, color: "var(--color-status-purple)" },
            { label: "Unemployed", value: 8, color: "var(--color-surface-active)" },
          ],
        }),
      }),
    );
    expect(html).toContain(">2.42<");
    expect(html).toContain(">M<");
    expect(html).not.toContain('role="progressbar"'); // no meter on this tile
    // composition segment widths threaded through (61/22/9/8 sum to 100)
    expect(html).toContain("width:61%");
    expect(html).toContain("width:22%");
    expect(html).toContain("width:9%");
    expect(html).toContain("width:8%");
    expect(html).toContain('role="img"'); // composition bar is a labelled image
    expect(html).toContain("Unsk 61%"); // legend
  });

  it("defaults to a 1-column grid span", () => {
    const html = renderToStaticMarkup(
      VitalTile({ label: "Stability", dotColor: "#06b6d4", value: "82" }),
    );
    expect(html).toContain("grid-column:span 1");
  });

  it("threads an explicit colSpan through to grid-column", () => {
    const html = renderToStaticMarkup(
      VitalTile({ label: "Population", dotColor: "#4c8dff", value: "2.42", colSpan: 2 }),
    );
    expect(html).toContain("grid-column:span 2");
  });
});

describe("CompositionBar — width math and a11y in the rendered markup", () => {
  it("a zero-total set renders every segment at 0% width (no NaN)", () => {
    const html = renderToStaticMarkup(
      CompositionBar({
        segments: [
          { label: "A", value: 0, color: "red" },
          { label: "B", value: 0, color: "blue" },
        ],
      }),
    );
    expect(html).toContain("width:0%");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).toContain('aria-label="Composition: A 0%, B 0%"');
  });
});

describe("GhostVitalTile — dashed future-slot placeholder", () => {
  it("renders the label and the future-slot names", () => {
    const html = renderToStaticMarkup(
      GhostVitalTile({ label: "Future vitals", future: "control · treasury · tax base · logistics" }),
    );
    expect(html).toContain("Future vitals");
    expect(html).toContain("control · treasury · tax base · logistics");
    expect(html).toContain("border-dashed"); // dashed ghost border
    expect(html).toContain("grid-column:span 1"); // default span
  });

  it("spans all 4 columns when colSpan={4} (full-width row-2 placement)", () => {
    const html = renderToStaticMarkup(
      GhostVitalTile({ label: "Future vitals", future: "control · treasury", colSpan: 4 }),
    );
    expect(html).toContain("grid-column:span 4");
  });
});

describe("VitalGrid — N-up wrapper", () => {
  it("defaults to a 2-column grid, stretches row items, and renders its tile children", () => {
    const html = renderToStaticMarkup(
      VitalGrid({
        children: [
          cloneElement(VitalTile({ label: "Stability", dotColor: "#06b6d4", value: "82", unit: "%" }), { key: "s" }),
          cloneElement(GhostVitalTile({ label: "Future vitals", future: "control · treasury" }), { key: "g" }),
        ],
      }),
    );
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("items-stretch");
    expect(html).toContain("Stability");
    expect(html).toContain("Future vitals");
  });

  it("honours an explicit column count (3-up needs no redesign)", () => {
    const html = renderToStaticMarkup(
      VitalGrid({
        columns: 3,
        children: VitalTile({ label: "Stability", dotColor: "#06b6d4", value: "82" }),
      }),
    );
    expect(html).toContain("grid-cols-3");
  });

  it("supports the Overview's 4-up layout with a 2-span child and a 4-span ghost", () => {
    const html = renderToStaticMarkup(
      VitalGrid({
        columns: 4,
        children: [
          cloneElement(VitalTile({ label: "Stability", dotColor: "#06b6d4", value: "82" }), { key: "s" }),
          cloneElement(VitalTile({ label: "Development", dotColor: "#d06a42", value: "41" }), { key: "d" }),
          cloneElement(
            VitalTile({ label: "Population", dotColor: "#4c8dff", value: "2.42", colSpan: 2 }),
            { key: "p" },
          ),
          cloneElement(
            GhostVitalTile({ label: "Future vitals", future: "control · treasury", colSpan: 4 }),
            { key: "g" },
          ),
        ],
      }),
    );
    expect(html).toContain("grid-cols-4");
    expect(html).toContain("grid-column:span 2");
    expect(html).toContain("grid-column:span 4");
  });
});
