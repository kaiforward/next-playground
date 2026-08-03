/**
 * Impact — who else reads this?
 *
 * Usage:
 *   npm run impact -- TARGET_COVER
 *   npm run impact -- demandRate --quiet
 *
 * Prints every reader of a symbol across the three surfaces that carry coupling in
 * this codebase, plus where each touched processor sits in the tick's run order.
 *
 * It exists because the most repeated design defect here is one quantity acquiring
 * readers in unrelated systems (TARGET_COVER, MIN_DEMAND, demandRate, surplusDrawable).
 * Answering "who else reads this?" from memory is how that defect gets created; this
 * answers it from the tracked tree.
 *
 * Surfaces, and why these three:
 *   1. Processor interfaces (`lib/tick/world/`) — compiler-enforced declarations of what
 *      each tick processor may read. A processor cannot read a field its interface does
 *      not declare, so this surface cannot silently rot.
 *   2. Tick internals (`lib/tick/`, `lib/engine/`, `lib/world/`, `lib/constants/`) — the
 *      simulation itself.
 *   3. Outside the tick (`lib/services/`, `app/`, `components/`, `lib/hooks/`) — read
 *      paths a simulation change can still break.
 *
 * Options:
 *   --quiet   Summary and processor ripple only; omit the full per-file hit list
 *   --help    Show this message
 *
 * Searches tracked files only (via `git grep`), because `.gitignore` makes the working
 * tree an unreliable guide to what is actually in the repo.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const TICK_FILE = "lib/world/tick.ts";
const WORLD_INTERFACE_DIR = "lib/tick/world";

/** A layer of the codebase, in the order we report them. */
interface Surface {
  readonly label: string;
  readonly paths: readonly string[];
}

const SURFACES: readonly Surface[] = [
  { label: "Tick simulation", paths: ["lib/tick", "lib/engine", "lib/world", "lib/constants"] },
  { label: "Outside the tick", paths: ["lib/services", "lib/hooks", "app", "components"] },
  { label: "Harness + tests", paths: ["lib/tick-harness", "scripts"] },
];

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function gitGrep(symbol: string, paths: readonly string[]): Hit[] {
  const args = ["grep", "-n", "--fixed-strings", "--word-regexp", symbol, "--", ...paths];
  let raw: string;
  try {
    raw = execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    // git grep exits 1 with no output when nothing matched — not an error here.
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const first = l.indexOf(":");
      const second = l.indexOf(":", first + 1);
      return {
        file: l.slice(0, first),
        line: Number(l.slice(first + 1, second)),
        text: l.slice(second + 1).trim(),
      };
    })
    .filter((h) => Number.isFinite(h.line));
}

function isTest(file: string): boolean {
  return file.includes("__tests__") || file.includes(".test.");
}

/**
 * A mention inside a comment is not a reader. Docstrings routinely name the constant
 * or function they are contrasting themselves with, and counting those inflates the
 * module list — surplusDrawable read as four callers when it has three, because two
 * files merely mention it in prose.
 */
function isComment(text: string): boolean {
  return /^(\/\/|\/\*|\*)/.test(text.trim());
}

/**
 * The module a file belongs to — the unit that actually matters for coupling.
 *
 * Grouping by layer (`lib/engine` vs `lib/services`) is useless here: pricing,
 * logistics and build planning all live in `lib/engine`, and lumping them together
 * reports TARGET_COVER — read by all three — as "local to one layer". The module
 * is the file's own name, which is what distinguishes them.
 */
function moduleOf(file: string): string {
  const parts = file.replace(/\.tsx?$/, "").split("/");
  const name = parts[parts.length - 1] ?? file;
  if (name === "index" || name === "types") {
    return parts.slice(-2).join("/");
  }
  return name;
}

/**
 * Processor run order, read from the tick body rather than hardcoded.
 * `directed-logistics-world.ts` → `runDirectedLogisticsProcessor` → its call line.
 */
function processorOrder(): Map<string, number> {
  const order = new Map<string, number>();
  let tick: string;
  try {
    tick = readFileSync(TICK_FILE, "utf8");
  } catch {
    return order;
  }
  const lines = tick.split("\n");
  for (const file of readdirSync(WORLD_INTERFACE_DIR)) {
    if (!file.endsWith("-world.ts")) continue;
    const slug = file.replace(/-world\.ts$/, "");
    const pascal = slug
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("");
    const call = `run${pascal}Processor(`;
    const index = lines.findIndex((l) => l.includes(call));
    if (index >= 0) order.set(slug, index + 1);
  }
  return order;
}

function processorLabel(slug: string): string {
  return slug.replace(/-/g, " ");
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help")) {
    console.log(
      [
        "Usage: npm run impact -- <SYMBOL> [--quiet]",
        "",
        "Prints every reader of a symbol across the tick simulation, the read paths",
        "outside the tick, and the harness — plus which tick processors declare it and",
        "where they sit in the run order.",
      ].join("\n"),
    );
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const quiet = argv.includes("--quiet");
  const symbol = argv.filter((a) => !a.startsWith("--"))[0];
  if (!symbol) {
    console.error("No symbol given. Usage: npm run impact -- <SYMBOL>");
    process.exit(1);
  }

  console.log(`\nIMPACT: ${symbol}\n${"=".repeat(60)}`);

  // ── Surface 1: which processors declare it ────────────────────────────────
  const order = processorOrder();
  const interfaceHits = gitGrep(symbol, [WORLD_INTERFACE_DIR]);
  const touchedProcessors = [
    ...new Set(
      interfaceHits
        .filter((h) => !isTest(h.file) && !isComment(h.text))
        .map((h) => h.file.split("/").pop()?.replace(/-world\.ts$/, "") ?? ""),
    ),
  ].filter((slug) => slug.length > 0);

  console.log("\nTICK RIPPLE — processors that READ it via their World interface");
  if (touchedProcessors.length === 0) {
    console.log("  none — no processor reads this through its declared interface.");
    console.log("  (A constant read straight from lib/constants/ never appears here;");
    console.log("   check the module list below.)");
  } else {
    const ranked = touchedProcessors
      .map((slug) => ({ slug, line: order.get(slug) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.line - b.line);
    const positions = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([slug]) => slug);
    for (const { slug } of ranked) {
      const idx = positions.indexOf(slug);
      const place = idx >= 0 ? `${idx + 1}/${positions.length}` : "not in run order";
      console.log(`  ${place.padEnd(16)} ${processorLabel(slug)}`);
    }
    if (ranked.length > 1) {
      console.log(
        `\n  ${ranked.length} processors read this. A change here lands on all of them,`,
      );
      console.log("  and the ones later in the run order see it in the SAME tick.");
    }
  }

  // ── Surfaces 2-4: every reader, grouped by module ─────────────────────────
  let totalProduction = 0;
  /** Module name → the surface it sits on. The count of these IS the coupling. */
  const modules = new Map<string, string>();

  for (const surface of SURFACES) {
    const hits = gitGrep(symbol, surface.paths);
    const live = hits.filter((h) => !isComment(h.text));
    const production = live.filter((h) => !isTest(h.file));
    const tests = live.length - production.length;
    const comments = hits.length - live.length;
    if (hits.length === 0) continue;

    if (surface.label !== "Harness + tests") {
      totalProduction += production.length;
      for (const h of production) modules.set(moduleOf(h.file), surface.label);
    }

    const byModule = new Map<string, Hit[]>();
    for (const h of production) {
      const key = moduleOf(h.file);
      const list = byModule.get(key);
      if (list) list.push(h);
      else byModule.set(key, [h]);
    }

    console.log(
      `\n${surface.label.toUpperCase()} — ${production.length} reference${
        production.length === 1 ? "" : "s"
      } in ${byModule.size} module${byModule.size === 1 ? "" : "s"}${
        tests > 0 ? ` (+${tests} in tests)` : ""
      }${comments > 0 ? ` (+${comments} in comments, not counted)` : ""}`,
    );

    for (const [mod, modHits] of [...byModule].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${mod.padEnd(30)} ${modHits.length}×  ${modHits[0]?.file ?? ""}`);
      if (quiet) continue;
      for (const h of modHits) {
        const text = h.text.length > 92 ? `${h.text.slice(0, 89)}...` : h.text;
        console.log(`      :${String(h.line).padEnd(5)} ${text}`);
      }
    }
  }

  // ── Producers the read surface cannot see ─────────────────────────────────
  //
  // The World interfaces declare what a processor READS. A processor that computes or
  // writes a quantity does so through its result type, so it never appears above.
  // Events is the standing example: it derives anchorMult and declares none of it,
  // which is exactly why it is the interaction people forget. Catch it by matching
  // module names against the processor roster.
  const processorSlugs = new Set(order.keys());
  const producers = [...modules.keys()].filter(
    (mod) => processorSlugs.has(mod) && !touchedProcessors.includes(mod),
  );
  if (producers.length > 0) {
    const positions = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([slug]) => slug);
    console.log("\nALSO TOUCHED BY — processors that do not declare it as a read");
    for (const mod of producers) {
      const idx = positions.indexOf(mod);
      console.log(`  ${`${idx + 1}/${positions.length}`.padEnd(16)} ${processorLabel(mod)}`);
    }
    console.log("\n  These most likely WRITE or derive it. A read-surface check alone misses");
    console.log("  them, and anything later in the run order sees what they wrote this tick.");
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const moduleCount = modules.size;
  console.log(`\n${"=".repeat(60)}`);
  if (totalProduction === 0) {
    console.log(`No production readers found for "${symbol}".`);
    console.log(
      "Check the spelling — or it is declared and unread, which is worth knowing either way.",
    );
  } else if (moduleCount > 2 || touchedProcessors.length > 1) {
    console.log(`SHARED — ${totalProduction} references across ${moduleCount} modules:`);
    console.log(`  ${[...modules.keys()].join(", ")}`);
    if (touchedProcessors.length > 1) {
      console.log(`  and ${touchedProcessors.length} tick processors.`);
    }
    console.log("\n  HAZARD 1 APPLIES. Each of those modules is a system that will move when");
    console.log("  this quantity moves. The spec must state, per module, whether this change");
    console.log("  separates it or deliberately keeps it coupled — a design that mentions only");
    console.log("  the module it cares about is how TARGET_COVER and MIN_DEMAND happened.");
    console.log("  Paste this output into the worksheet. The row's value is that it was read.");
  } else {
    console.log(`CONTAINED — ${totalProduction} references across ${moduleCount} module(s):`);
    console.log(`  ${[...modules.keys()].join(", ")}`);
    console.log("  Still record it — the second reader is where the defect starts.");
  }
  console.log("");
}

main();
