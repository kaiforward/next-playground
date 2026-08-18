import { describe, expect, it } from "vitest";

import { commentSentences, isProse, isTest, mergeRuns, normalise } from "../duplication";

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
    chars: 200,
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
