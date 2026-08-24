import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide grep red-proof for Task 15 (habitability-seeding amendment, 2026-08-24): the
 * industry-land budget is deleted everywhere it was authored, generated, aggregated, or gated on.
 * A handful of `industryLand` mentions legitimately remain — each is a compile-preserving deviation
 * this task recorded for a LATER task (16 or 17) to finish deleting, and each carries its own
 * doc-comment naming that task. This test pins the exact allowlist so a NEW, undocumented
 * `industryLand` reference (a reintroduced gate, a copy-pasted fixture field, a careless revert)
 * fails loudly instead of slipping back in silently.
 */
describe("industryLand — repo-wide sweep (Task 15 grep red-proof)", () => {
  const here = fileURLToPath(import.meta.url);
  const repoRoot = join(dirname(here), "..", "..", "..");

  const SCAN_DIRS = ["lib", "components", "client", "scripts"];
  const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "__tests__"]);

  /**
   * Every non-test source file still allowed to mention `industryLand` — each is a documented,
   * compile-preserving deviation this task recorded for Task 16 (development/colonisation-value
   * re-derivation) or Task 17 (UI/BodyView cleanup) to finish. Task 18's own instrument recut
   * (scripts/substrate-coherence.ts) is exempt entirely since it is this branch's own live-in-flight
   * instrument, not shipped product code.
   */
  const ALLOWED_FILES = new Set([
    // Task 16 — development axis re-derivation (worked levels ÷ authored deposit counts).
    "lib/constants/colonisation.ts",
    "lib/engine/colonisation-value.ts",
    "lib/engine/development-points.ts",
    "lib/engine/development.ts",
    "lib/services/system-development.ts",
    "lib/tick/adapters/memory/directed-build.ts",
    "lib/world/tick.ts",
    // ColonyEstablishCandidate.industryLand — same Task 16 term (LAND_GENERAL_WEIGHT).
    "lib/engine/directed-build.ts",
    // Task 17 — BodyView / astrography UI cleanup.
    "lib/types/api.ts",
    "lib/services/universe.ts",
    "components/system/body-card.tsx",
    // Task 18 — this branch's own live instrument, recut in that task.
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
});
