/**
 * Fixed-width table rendering for the calibration harness's terminal report.
 *
 * Lives here rather than in `scripts/simulate.ts` so it is reachable by the unit project
 * (which globs `lib/**`) — the script itself runs `main()` at import and cannot be loaded
 * by a test. Presentation only: callers format their own cells and this pads and joins them.
 */

export type ColAlign = "l" | "r";

export function pad(str: string, width: number): string {
  return str.padEnd(width);
}

export function rpad(str: string, width: number): string {
  return str.padStart(width);
}

/**
 * One table: header row, dash separator, data rows. Cells arrive already formatted — this only
 * pads and joins them. Alignment defaults to label-left / values-right; pass `align` for the
 * tables whose columns don't follow that shape.
 *
 * Throws on a column-count mismatch rather than rendering a misaligned table. Padding cannot
 * fail on its own: `padEnd`/`padStart` coerce an undefined width to 0 and return the string
 * unchanged, so a desynced call site would otherwise print quietly garbled output. Every call
 * site passes headers, widths and align as separate literals with nothing structurally tying
 * them together, which is exactly the shape that drifts under later edits.
 */
export function renderTable(
  headers: string[],
  widths: number[],
  rows: string[][],
  align: ColAlign[] = headers.map((_, i) => (i === 0 ? "l" : "r")),
): string[] {
  const cols = headers.length;
  if (widths.length !== cols || align.length !== cols) {
    throw new Error(
      `renderTable: ${cols} headers but ${widths.length} widths and ${align.length} align entries`,
    );
  }
  const bad = rows.findIndex((r) => r.length !== cols);
  if (bad !== -1) {
    throw new Error(`renderTable: row ${bad} has ${rows[bad].length} cells, expected ${cols}`);
  }

  const line = (cells: string[]): string =>
    cells.map((c, i) => (align[i] === "l" ? pad(c, widths[i]) : rpad(c, widths[i]))).join(" | ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("-+-"), ...rows.map(line)];
}
