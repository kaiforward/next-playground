import { describe, it, expect } from "vitest";
import { renderTable } from "@/lib/tick-harness/table";

describe("renderTable", () => {
  it("defaults to label-left, values-right and sizes the separator to the widths", () => {
    const [header, sep, row] = renderTable(["Good", "Cover"], [8, 6], [["fuel", "0.87"]]);
    expect(header).toBe("Good     |  Cover");
    expect(sep).toBe("---------+-------"); // 8 dashes + "-+-" + 6 dashes
    expect(row).toBe("fuel     |   0.87");
  });

  it("applies a per-column align override to the header and the rows alike", () => {
    const [header, , row] = renderTable(
      ["Type", "Sev"],
      [6, 5],
      [["quake", "1.0"]],
      ["l", "l"],
    );
    // Both left-padded: the override governs the header row too, not just the data.
    expect(header).toBe("Type   | Sev  ");
    expect(row).toBe("quake  | 1.0  ");
  });

  it("renders every row, in the order given", () => {
    const lines = renderTable(["A"], [3], [["x"], ["y"], ["z"]], ["l"]);
    expect(lines).toHaveLength(5); // header + separator + 3 rows
    expect(lines.slice(2)).toEqual(["x  ", "y  ", "z  "]);
  });

  // The guard's whole point: padEnd/padStart coerce an undefined width to 0 and return the
  // string unchanged, so without these throws a desynced call site prints garbled output and
  // reports success. Each case below renders "fine" if the guard is removed.
  it("throws when widths do not match the header count", () => {
    expect(() => renderTable(["A", "B"], [4], [["x", "y"]])).toThrow(/2 headers but 1 widths/);
  });

  it("throws when align does not match the header count", () => {
    expect(() => renderTable(["A", "B"], [4, 4], [["x", "y"]], ["l"])).toThrow(/1 align entries/);
  });

  it("throws when a row has the wrong cell count, naming the row", () => {
    expect(() => renderTable(["A", "B"], [4, 4], [["x", "y"], ["z"]])).toThrow(
      /row 1 has 1 cells, expected 2/,
    );
  });
});
