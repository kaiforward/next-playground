import { describe, expect, it } from "vitest";

import { commentSentences, isProse, isTest, mergeRuns, normalise, scan } from "../duplication";

const text = (source: string) => normalise(source).map((l) => l.text);

describe("isProse", () => {
  it("rejects the rule banners that appear in dozens of files", () => {
    expect(isProse("------------------------------------------------------------------")).toBe(false);
    expect(isProse("/* ============================================================== */")).toBe(false);
    expect(isProse("=== Primary nav ===")).toBe(false);
  });

  it("accepts an ordinary docstring sentence", () => {
    expect(
      isProse("Returns an empty map when the mode is inactive so the Pixi layer tears down."),
    ).toBe(true);
  });

  it("rejects prose too short to be worth comparing, however wordy", () => {
    expect(isProse("one two three four five")).toBe(false);
  });

  it("rejects a line that is mostly punctuation despite carrying enough words", () => {
    // Six real words, so the word count alone lets this through — it is the letter
    // density that rejects it. A markdown table row in a docstring is the live case.
    const tableRow = "| alpha | beta | gamma | delta | epsilon | zeta | --- | --- | --- | --- |";
    expect(tableRow.match(/[A-Za-z][A-Za-z'-]+/g)).toHaveLength(6);
    expect(isProse(tableRow)).toBe(false);
  });
});

describe("normalise", () => {
  it("drops line comments, block comments and blank lines, keeping source line numbers", () => {
    const result = normalise(
      [
        "// a leading comment",
        "",
        "const a = 1;",
        "/* a block",
        "   spanning lines */",
        "const b = 2;",
      ].join("\n"),
    );
    expect(result).toEqual([
      { line: 3, text: "const a = 1;" },
      { line: 6, text: "const b = 2;" },
    ]);
  });

  it("blanks string contents but keeps the quotes, so shape survives a renamed URL", () => {
    expect(text(`const url = "/api/game/stability";`)).toEqual([`const url = "";`]);
    expect(text("const key = `system-${id}`;")).toEqual(["const key = ``;"]);
  });

  it("collapses whitespace so reindented copies still match", () => {
    expect(text("  const   a =    1;  ")).toEqual(["const a = 1;"]);
  });

  it("strips comments before strings, so an apostrophe in prose cannot swallow the line", () => {
    // Were strings blanked first, the apostrophe in "layer's" would open a phantom literal
    // and eat everything up to the next quote — including the following line of real code.
    const result = text(["// the layer's own copy", `const a = "x";`].join("\n"));
    expect(result).toEqual([`const a = "";`]);
  });

  it("keeps a `/*` inside a line comment from opening a block comment", () => {
    // The live case: a route glob written in a `//` comment. A pass that hunted for `/*`
    // before stripping `//` opened a block comment here and swallowed the rest of the file
    // up to the next literal `*/` — ten lines of a real layout, invisible to both detectors.
    const result = text(
      [
        "// Matched by the catch-all route, not by /system/*.",
        "const a = 1;",
        "const b = 2;",
      ].join("\n"),
    );
    expect(result).toEqual(["const a = 1;", "const b = 2;"]);
  });

  it("keeps a `/*` inside a string literal from opening a block comment", () => {
    // The other live case: a glob inside a help string swallowed 72 lines to end of file.
    const result = text(
      [`console.log("write to experiments/*.json");`, "const a = 1;", "const b = 2;"].join("\n"),
    );
    expect(result).toEqual([`console.log("");`, "const a = 1;", "const b = 2;"]);
  });

  it("keeps a `//` inside a string literal from truncating the line", () => {
    expect(text(`const req = new Request("http://x/y", { method: "POST" });`)).toEqual([
      `const req = new Request("", { method: "" });`,
    ]);
  });

  it("honours backslash escapes, so an escaped quote does not close the literal", () => {
    expect(text(`const s = "a\\"b//c"; const t = 1;`)).toEqual([`const s = ""; const t = 1;`]);
  });

  it("treats a quote with no partner on its line as an ordinary character", () => {
    // A `'` in a character class has no closing quote. Opening a literal there would blank
    // the rest of the line; JSX prose with an apostrophe is the same shape.
    const line = `const words = text.match(/[A-Za-z'-]+/g) ?? [];`;
    expect(text(line)).toEqual([line]);
  });

  it("gives two copies that differ only in names, strings and comments the same shape", () => {
    const first = [
      "// Fetch the stability map.",
      "export function useStability(active: boolean) {",
      `  const { data } = useQuery({ queryKey: ["stability"], url: "/api/stability" });`,
      "  return data;",
      "}",
    ].join("\n");
    const second = [
      "// Mirrors useStability, for population.",
      "export function useStability(active: boolean) {",
      `  const { data } = useQuery({ queryKey: ["population"], url: "/api/population" });`,
      "  return data;",
      "}",
    ].join("\n");
    expect(text(first)).toEqual(text(second));
  });

  it("keeps two genuinely different bodies apart", () => {
    expect(text("const a = 1;")).not.toEqual(text("const a = 2;"));
  });
});

describe("commentSentences", () => {
  it("joins a sentence wrapped across several comment lines", () => {
    const source = [
      "// Returns an empty map when the mode is inactive, even when cached data",
      "// exists, so that the Pixi layer tears itself down.",
      "const a = 1;",
    ].join("\n");
    expect(commentSentences("f.ts", source).map((s) => s.text)).toEqual([
      "Returns an empty map when the mode is inactive, even when cached data exists, so that the Pixi layer tears itself down.",
    ]);
  });

  it("reports the line the comment block started on", () => {
    const source = [
      "const a = 1;",
      "// Returns an empty map when the mode is inactive so the layer tears down.",
    ].join("\n");
    expect(commentSentences("f.ts", source)[0].line).toBe(2);
  });

  it("splits a block comment into sentences and drops the short ones", () => {
    const source = [
      "/**",
      " * Short one.",
      " * Returns an empty map when the mode is inactive so the Pixi layer tears down.",
      " */",
    ].join("\n");
    expect(commentSentences("f.ts", source).map((s) => s.text)).toEqual([
      "Returns an empty map when the mode is inactive so the Pixi layer tears down.",
    ]);
  });

  it("ignores a banner, which is long enough but says nothing", () => {
    const source = "/* ------------------------------------------------------------------ */";
    expect(commentSentences("f.ts", source)).toEqual([]);
  });

  it("does not treat code as a comment", () => {
    expect(commentSentences("f.ts", `const a = "// not a comment, just a long enough string";`)).toEqual(
      [],
    );
  });
});

describe("mergeRuns", () => {
  const window = (file: string, index: number, size: number) => ({
    file,
    index,
    startLine: index + 1,
    endLine: index + size,
  });

  it("collapses windows that slid over one duplicated region into a single pair", () => {
    const pairs = [0, 1, 2].map((offset) => ({
      changed: window("a.ts", 10 + offset, 6),
      other: window("b.ts", 40 + offset, 6),
      lines: 6,
    }));
    const merged = mergeRuns(pairs, 6);
    expect(merged).toHaveLength(1);
    expect(merged[0].lines).toBe(8);
    expect(merged[0].changed.startLine).toBe(11);
    expect(merged[0].changed.endLine).toBe(18);
    expect(merged[0].other.endLine).toBe(48);
  });

  it("keeps two separate duplicated regions in the same file pair apart", () => {
    const pairs = [
      { changed: window("a.ts", 10, 6), other: window("b.ts", 40, 6), lines: 6 },
      { changed: window("a.ts", 90, 6), other: window("b.ts", 200, 6), lines: 6 },
    ];
    expect(mergeRuns(pairs, 6)).toHaveLength(2);
  });

  it("does not merge windows that drifted apart in the other file", () => {
    // Adjacent on the changed side but not on the other side means two different copies,
    // not one run — merging them would report a span neither file actually contains.
    const pairs = [
      { changed: window("a.ts", 10, 6), other: window("b.ts", 40, 6), lines: 6 },
      { changed: window("a.ts", 11, 6), other: window("b.ts", 400, 6), lines: 6 },
    ];
    expect(mergeRuns(pairs, 6)).toHaveLength(2);
  });
});

describe("isTest", () => {
  it("recognises both conventions used in this repo", () => {
    expect(isTest("lib/services/__tests__/atlas.test.ts")).toBe(true);
    expect(isTest("components/ui/popover.test.tsx")).toBe(true);
    expect(isTest("lib/services/atlas.ts")).toBe(false);
    expect(isTest("lib/engine/contest.ts")).toBe(false);
  });
});

describe("scan", () => {
  // Smaller than the shipped defaults (6 lines / 120 chars) so a fixture stays readable.
  // The window and merge logic under test does not depend on the size.
  const OPTIONS = { minLines: 3, minChars: 40 };

  const SENTENCE = "Returns an empty map when the mode is inactive so the Pixi layer tears down.";

  /** Four lines that hash to two windows at `minLines: 3`, so a copy of it merges to one pair. */
  const SHARED = [
    "export function stabilityRows(active: boolean) {",
    "  const rows = readRows(active, DEFAULT_LIMIT);",
    "  return rows.filter((row) => row.value > 0);",
    "}",
  ].join("\n");

  /** Eight lines, so a copy slides six windows over the same region. */
  const LONG_SHARED = [
    "export function stabilityRows(active: boolean) {",
    "  const rows = readRows(active, DEFAULT_LIMIT);",
    "  const live = rows.filter((row) => row.value > 0);",
    "  const byId = new Map(live.map((row) => [row.id, row]));",
    "  const total = live.reduce((sum, row) => sum + row.value, 0);",
    "  if (total === 0) return EMPTY_ROWS;",
    "  return { byId, total };",
    "}",
  ].join("\n");

  /**
   * Five lines of padding no other fixture shares, so a neutered hash shows up as extra
   * pairs. It ends on a line carrying the tag, so the window straddling the join into the
   * shared block differs between two files and the reported region is the shared one.
   */
  const unique = (tag: string) =>
    [
      `export const ${tag}Limit = 12;`,
      `export function ${tag}Total(rows: Row[]) {`,
      `  return rows.reduce((sum, row) => sum + row.${tag}, 0);`,
      "}",
      `export const ${tag}Ready = true;`,
    ].join("\n");

  const span = (p: {
    changed: { file: string; startLine: number; endLine: number };
    other: { file: string; startLine: number; endLine: number };
  }) =>
    `${p.changed.file}:${p.changed.startLine}-${p.changed.endLine} <-> ` +
    `${p.other.file}:${p.other.startLine}-${p.other.endLine}`;

  const ends = (p: { a: { file: string; line: number }; b: { file: string; line: number } }) =>
    [`${p.a.file}:${p.a.line}`, `${p.b.file}:${p.b.line}`].sort().join(" <-> ");

  it("reports a comment sentence copied into a second file", () => {
    const sources = new Map([
      ["a.ts", [`// ${SENTENCE}`, "export const alpha = 1;"].join("\n")],
      ["b.ts", [`// ${SENTENCE}`, "export const beta = 2;"].join("\n")],
    ]);
    const result = scan(sources, new Set(["a.ts"]), OPTIONS);
    expect(result.textual.map(ends)).toEqual(["a.ts:1 <-> b.ts:1"]);
    expect(result.textual[0].text).toBe(SENTENCE);
    // The changed file is always the `a` end, so a reader can see which side is theirs.
    expect(result.textual[0].a.file).toBe("a.ts");
    expect(result.structural).toEqual([]);
  });

  it("reports a comment sentence repeated further down the same file", () => {
    // Same-file repetition is where most of this repo's real duplication was found, and
    // the structural detector has always counted it. Both ends carry the same file here.
    const lines = Array.from({ length: 14 }, (_, i) => `const filler${i} = ${i};`);
    lines[2] = `// ${SENTENCE}`;
    lines[11] = `// ${SENTENCE}`;
    const result = scan(new Map([["a.ts", lines.join("\n")]]), new Set(["a.ts"]), OPTIONS);
    expect(result.textual.map(ends)).toEqual(["a.ts:12 <-> a.ts:3"]);
  });

  it("keeps both orderings of one repeated sentence across two files", () => {
    // The dedup key sorted a mixed string/number array, so "12" sorted before "3" and the
    // pair (a:3, b:12) collided with (a:12, b:3) — the second was silently dropped.
    const body = () => {
      const lines = Array.from({ length: 14 }, (_, i) => `const filler${i} = ${i};`);
      lines[2] = `// ${SENTENCE}`;
      lines[11] = `// ${SENTENCE}`;
      return lines.join("\n");
    };
    const result = scan(
      new Map([
        ["a.ts", body()],
        ["b.ts", body()],
      ]),
      new Set(["a.ts"]),
      OPTIONS,
    );
    expect(result.textual.map(ends).sort()).toEqual([
      "a.ts:12 <-> a.ts:3",
      "a.ts:12 <-> b.ts:12",
      "a.ts:12 <-> b.ts:3",
      "a.ts:3 <-> b.ts:12",
      "a.ts:3 <-> b.ts:3",
    ]);
  });

  it("reports a code shape copied into a second file, once per region", () => {
    const sources = new Map([
      ["a.ts", [unique("alpha"), SHARED].join("\n")],
      ["b.ts", [unique("beta"), SHARED].join("\n")],
    ]);
    const result = scan(sources, new Set(["a.ts"]), OPTIONS);
    expect(result.structural.map(span)).toEqual(["a.ts:6-9 <-> b.ts:6-9"]);
    expect(result.structural[0].lines).toBe(4);
    expect(result.textual).toEqual([]);
  });

  it("reports a code shape repeated within one file", () => {
    const sources = new Map([["a.ts", [SHARED, unique("gamma"), SHARED].join("\n")]]);
    const result = scan(sources, new Set(["a.ts"]), OPTIONS);
    expect(result.structural.map(span)).toEqual(["a.ts:1-4 <-> a.ts:10-13"]);
  });

  it("reports a sliding run as one merged pair, not one per window", () => {
    const sources = new Map([
      ["a.ts", [unique("delta"), LONG_SHARED].join("\n")],
      ["b.ts", [unique("epsilon"), LONG_SHARED].join("\n")],
    ]);
    const result = scan(sources, new Set(["a.ts"]), OPTIONS);
    // Six windows slid over the shared eight lines; one pair comes back.
    expect(result.structural.map(span)).toEqual(["a.ts:6-13 <-> b.ts:6-13"]);
    expect(result.structural[0].lines).toBe(8);
  });

  it("does not report a window against an overlapping copy of itself", () => {
    // Five identical rows give three windows at `minLines: 3`, every one of them overlapping
    // the others. That is one repetitive table, not a shape written twice, so nothing comes
    // back — the same-file detector only pairs windows that share no line.
    const row = "  { label: `x`, value: rows.length, tone: `neutral` },";
    const sources = new Map([["a.ts", Array.from({ length: 5 }, () => row).join("\n")]]);
    expect(scan(sources, new Set(["a.ts"]), OPTIONS).structural).toEqual([]);
  });

  it("ignores a shared run too sparse to mean anything", () => {
    // Closing braces and a re-export match everywhere; the character floor is what keeps
    // the report from filling with them.
    const tail = ["  });", "}", "export {};"].join("\n");
    const sources = new Map([
      ["a.ts", [unique("alpha"), tail].join("\n")],
      ["b.ts", [unique("beta"), tail].join("\n")],
    ]);
    expect(scan(sources, new Set(["a.ts"]), OPTIONS).structural).toEqual([]);
  });

  it("reports nothing when neither side of a pair is a changed file", () => {
    // The anchor is the whole point: pre-existing duplication between two untouched files
    // stays silent, so the output is about the change under review.
    const sources = new Map([
      ["a.ts", [`// ${SENTENCE}`, unique("alpha"), SHARED].join("\n")],
      ["b.ts", [`// ${SENTENCE}`, unique("beta"), SHARED].join("\n")],
      ["z.ts", unique("zeta")],
    ]);
    const result = scan(sources, new Set(["z.ts"]), OPTIONS);
    expect(result.textual).toEqual([]);
    expect(result.structural).toEqual([]);
  });
});
