import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { TERMS } from "../terms";

describe("terms.ts stays verbatim with docs/active/glossary.md", () => {
  test("every entry concatenates back to the doc's exact wording", () => {
    const doc = readFileSync("docs/active/glossary.md", "utf8").replace(/\r\n/g, "\n");
    const defs = doc.split(/^## Definitions$/m)[1].split(/^## Still open$/m)[0] + "\n\n";
    const entryRe = /^\*\*(.+?)\*\* — ([\s\S]*?)(?=\n\n)/gm;
    const docEntries: { term: string; body: string }[] = [];
    for (const m of defs.matchAll(entryRe)) {
      docEntries.push({ term: m[1], body: m[2].replace(/\s*\n\s*/g, " ").trim() });
    }
    expect(docEntries.length).toBe(88);
    const rendered = new Map(
      Object.values(TERMS).map((d) => [
        d.term,
        d.body.map((s) => (s.kind === "text" ? s.text : s.label)).join(""),
      ]),
    );
    for (const e of docEntries) {
      expect(rendered.get(e.term), e.term).toBe(e.body);
    }
    expect(rendered.size).toBe(docEntries.length);
  });
});
