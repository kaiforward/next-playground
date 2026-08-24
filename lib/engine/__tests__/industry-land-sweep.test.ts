import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide grep red-proof: the
 * industry-land budget is deleted everywhere it was authored, generated, aggregated, or gated on.
 * A handful of `industryLand` mentions legitimately remain — each is a compile-preserving deviation
 * this task recorded for a LATER task (16 or 17) to finish deleting, and each carries its own
 * doc-comment naming that task. This test pins the exact allowlist so a NEW, undocumented
 * `industryLand` reference (a reintroduced gate, a copy-pasted fixture field, a careless revert)
 * fails loudly instead of slipping back in silently.
 */
describe("industryLand — repo-wide sweep", () => {
  const here = fileURLToPath(import.meta.url);
  const repoRoot = join(dirname(here), "..", "..", "..");

  const SCAN_DIRS = ["lib", "components", "client", "scripts"];
  const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "__tests__"]);

  /**
   * Every non-test source file still allowed to mention `industryLand`. One remains:
   * `scripts/substrate-coherence.ts` is this branch's own live-in-flight instrument — not shipped
   * product code — exempt until its own recut (Task 18) deletes the mention.
   */
  const ALLOWED_FILES = new Set([
    "scripts/substrate-coherence.ts",
  ]);

  function listFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const entryDir = entry.parentPath;
      const segments = relative(repoRoot, entryDir).split(/[\\/]/);
      if (segments.some((s) => SKIP_DIR_NAMES.has(s))) continue;
      if (entry.name.includes(".test.")) continue;
      out.push(join(entryDir, entry.name));
    }
    return out;
  }

  it("every remaining industryLand reference is in the documented deviation allowlist", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = join(repoRoot, dir);
      for (const file of listFiles(abs)) {
        const src = readFileSync(file, "utf8");
        if (!/\bindustryLand\b/.test(src)) continue;
        const relPath = relative(repoRoot, file).split("\\").join("/");
        hits.push(relPath);
      }
    }
    const unexpected = hits.filter((f) => !ALLOWED_FILES.has(f));
    expect(unexpected).toEqual([]);
  });

  // Non-vacuity: the allowlist itself is not empty and the scan actually walks real files — a
  // scanner that silently found nothing would let this whole test pass for the wrong reason.
  it("the scan actually finds source files (non-vacuity)", () => {
    let total = 0;
    for (const dir of SCAN_DIRS) total += listFiles(join(repoRoot, dir)).length;
    expect(total).toBeGreaterThan(100);
  });

  /**
   * The "one shared coefficient" grep check, re-stated for the deleted
   * LAND_GENERAL_WEIGHT term): with the industry-land budget gone, `colonyValue`'s L(c) carries only
   * `landPremium` and `landDepositWeight` — no second land coefficient (general-space weight, or any
   * other disagreeing constant) may reappear anywhere in shipped source, undocumented or not.
   */
  it("landGeneralWeight / LAND_GENERAL_WEIGHT have zero hits repo-wide", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = join(repoRoot, dir);
      for (const file of listFiles(abs)) {
        const src = readFileSync(file, "utf8");
        if (/\blandGeneralWeight\b|\bLAND_GENERAL_WEIGHT\b/.test(src)) {
          hits.push(relative(repoRoot, file).split("\\").join("/"));
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
