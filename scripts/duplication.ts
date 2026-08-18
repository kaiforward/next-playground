/**
 * Duplication — has this been written before?
 *
 * Usage:
 *   npm run duplication                          Compare the branch's changed files against the repo
 *   npm run duplication -- lib/services/atlas.ts Compare the named files against the repo
 *   npm run duplication -- "a.ts b.ts,c.tsx"     Paths split on whitespace or commas, quoted or not
 *   npm run duplication -- --all                 Every tracked file against every other (the baseline sweep)
 *
 * Reports pairs of the form `changed-file:line <-> existing-file:line` where the same
 * prose or the same code shape already exists somewhere else in the tree.
 *
 * It exists because the review pipeline is chunk-scoped and duplication is not. Every
 * reviewer sees a slice of one diff, and the copy is almost always in a file that diff
 * never touched: five byte-identical value-mode map hooks landed across five PRs two
 * months apart, and no diff of any size ever contained two of them. The missing
 * capability is repo-wide search, which is mechanical — so a script does it, and the
 * conventions reviewer adjudicates what comes back.
 *
 * Two detectors, both anchored on the changed files:
 *
 *   Textual    Every comment sentence of >=45 characters that appears verbatim elsewhere,
 *              in another file or further down the same one. Copied code usually arrives
 *              with its docstring still attached, so this is cheap, has near-zero false
 *              positives, and on its own catches the class of miss that motivated the
 *              instrument.
 *   Structural Lines normalised (comments removed, string contents blanked, whitespace
 *              collapsed), hashed in sliding 6-line windows, indexed repo-wide. Catches
 *              copies whose comments were reworded, which the textual pass cannot see.
 *
 * Anchoring on changed files is the whole point: a pair is only reported when one side is
 * a file the current change touched, so pre-existing duplication stays silent and the
 * output stays about the change under review. That only works if the standing stock is
 * kept near zero — `--all` is how you check that it still is.
 *
 * This is an input to judgement, never a gate. It always exits 0. Two files can share a
 * shape and still be two different things: sessionStorage and localStorage wrappers look
 * alike and differ in lifecycle, and per-processor read views are a sanctioned seam. The
 * script does not know that and does not try to. It emits every candidate it finds; the
 * reader decides which ones are the same decision expressed twice.
 *
 * The one thing it will not do quietly is nothing: if every path it was handed turns out
 * to be unreadable or not source, it says so on stderr instead of printing an empty
 * report, because an empty report from a misuse is indistinguishable from a clean repo.
 *
 * Options:
 *   --all             Treat every tracked file as changed (repo-wide baseline sweep)
 *   --min-lines <n>   Structural window size in normalised lines (default 6)
 *   --min-chars <n>   Minimum normalised characters in a window, to skip brace runs (default 120)
 *   --quiet           Pairs only; omit the matched text
 *   --help            Show this message
 *
 * The corpus searched is the tracked tree (via `git ls-files`), because `.gitignore` makes
 * the working tree an unreliable guide to what is in the repo — plus any file the caller
 * names and any source file the branch has added but not yet committed. A new uncommitted
 * file is the highest-value thing this instrument can be pointed at, so it is compared
 * both ways: against the tracked tree, and as part of the corpus everything else sees.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/** A comment sentence long enough that two files sharing it verbatim is not a coincidence. */
const MIN_SENTENCE_CHARS = 45;

/** Words a sentence needs before it counts as prose rather than decoration. */
const MIN_SENTENCE_WORDS = 6;

/**
 * Whether a comment is prose or furniture. Rule banners (`/* ----- *\/`), boxed section
 * headers and separator rows are long, identical everywhere, and say nothing — left in,
 * they bury the real matches under hundreds of pairs.
 */
export function isProse(text: string): boolean {
  const words = text.match(/[A-Za-z][A-Za-z'-]+/g) ?? [];
  if (words.length < MIN_SENTENCE_WORDS) return false;
  const letters = text.replace(/[^A-Za-z]/g, "").length;
  return letters / text.length >= 0.5;
}

interface Options {
  readonly all: boolean;
  readonly minLines: number;
  readonly minChars: number;
  readonly quiet: boolean;
  readonly files: readonly string[];
}

/** How wide and how dense a window has to be before it is worth reporting. */
export interface ScanOptions {
  readonly minLines: number;
  readonly minChars: number;
}

/** One normalised line, carrying the 1-based line number it came from. */
export interface CodeLine {
  readonly line: number;
  readonly text: string;
}

/** A sentence lifted out of a comment, with where it was found. */
export interface Sentence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** A run of consecutive normalised lines that hashes identically in two places. */
export interface Window {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly index: number;
}

export interface StructuralPair {
  readonly changed: Window;
  readonly other: Window;
  readonly lines: number;
}

export interface TextualPair {
  readonly a: Sentence;
  readonly b: Sentence;
  readonly text: string;
}

/** Everything the detectors found, before any of it is formatted for a terminal. */
export interface ScanResult {
  readonly textual: readonly TextualPair[];
  readonly structural: readonly StructuralPair[];
  readonly normalised: ReadonlyMap<string, readonly CodeLine[]>;
}

function parseArgs(argv: readonly string[]): Options {
  const files: string[] = [];
  let all = false;
  let quiet = false;
  let minLines = 6;
  let minChars = 120;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--quiet") {
      quiet = true;
    } else if (arg === "--min-lines") {
      minLines = Number(argv[++i]);
    } else if (arg === "--min-chars") {
      minChars = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(0);
    } else {
      // Paths arrive space-separated, comma-separated, or as one quoted argument holding
      // several — `npm run duplication -- "a.ts b.ts"` is a single argv entry, and it is
      // how the review pipeline calls this. Splitting on commas alone made that a no-op.
      files.push(...arg.split(/[\s,]+/).filter((f) => f.length > 0));
    }
  }

  if (!Number.isFinite(minLines) || minLines < 2) {
    console.error("--min-lines must be an integer of 2 or more");
    process.exit(0);
  }
  if (!Number.isFinite(minChars) || minChars < 0) {
    console.error("--min-chars must be 0 or more");
    process.exit(0);
  }

  return { all, quiet, minLines, minChars, files };
}

function printHelp(): void {
  const header = readFileSync(new URL(import.meta.url), "utf8").split("*/")[0];
  // `\r?` because a CRLF checkout otherwise leaves the opening `/**` on the first line.
  console.log(header.replace(/^\/\*\*\r?\n/, "").replace(/^ \* ?/gm, ""));
}

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function isSource(file: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext));
}

/**
 * Tests repeat themselves by nature — arrange blocks, fixture builders, table rows — and
 * a repeated arrange block is usually the right call. Their pairs are still reported, but
 * after the source pairs, so a real one is never buried under a hundred of them.
 */
export function isTest(file: string): boolean {
  return file.includes("__tests__/") || /\.test\.tsx?$/.test(file);
}

function trackedSourceFiles(): string[] {
  return git(["ls-files", "--", "*.ts", "*.tsx"])
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && isSource(f));
}

/**
 * Files the current branch touches, against its merge-base with main — committed, working
 * tree and not-yet-added alike. Used when the caller names no files, so the common case is
 * a bare `npm run duplication`.
 */
function changedAgainstMain(): string[] {
  let base: string;
  try {
    base = git(["merge-base", "HEAD", "main"]).trim();
  } catch {
    return [];
  }
  const committed = git(["diff", "--name-only", "--diff-filter=d", base, "HEAD"]);
  const working = git(["diff", "--name-only", "--diff-filter=d", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...committed.split("\n"), ...working.split("\n"), ...untracked.split("\n")])]
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && isSource(f));
}

/**
 * Index just past the literal opened at `start`, or -1 when its closing quote is not on
 * this line. Backslash escapes are skipped, so `"a\"b"` closes at the second real quote.
 */
function closeQuote(raw: string, start: number): number {
  const quote = raw[start];
  for (let i = start + 1; i < raw.length; i++) {
    if (raw[i] === "\\") {
      i++;
      continue;
    }
    if (raw[i] === quote) return i + 1;
  }
  return -1;
}

/**
 * Strip comments and blank the contents of string literals, so two copies that were
 * reworded or had their identifiers left alone still hash alike.
 *
 * One left-to-right pass per line, because `//`, `/*`, `'`, `"` and `` ` `` all shadow
 * each other and no ordering of separate regex passes gets that right: strings hide
 * comment openers (`"(experiments/*.json)"`), comments hide string openers (`// the
 * layer's own copy`). The scan tracks which of code, line comment, block comment or the
 * three string kinds it is in and honours escapes; only the block-comment state carries
 * to the next line.
 *
 * A quote with no partner on its own line is emitted as an ordinary character rather than
 * opening a literal that swallows everything after it — an apostrophe in JSX text and a
 * `'` inside a character class are both far commoner than a string broken across lines.
 * The cost is that the body of a multi-line template reads as code; that matches what the
 * quotes actually say, and the alternative reads a stray backtick as a template opener
 * and blanks the rest of the file.
 *
 * Returns one entry per non-empty line, carrying the original 1-based line number.
 */
export function normalise(source: string): CodeLine[] {
  const out: CodeLine[] = [];
  let inBlockComment = false;

  source.split("\n").forEach((raw, index) => {
    let code = "";
    let i = 0;

    while (i < raw.length) {
      if (inBlockComment) {
        const close = raw.indexOf("*/", i);
        if (close === -1) break;
        inBlockComment = false;
        // A space, so `a/* why */b` reads as two tokens rather than one.
        code += " ";
        i = close + 2;
        continue;
      }

      const char = raw[i];
      const next = raw[i + 1];

      if (char === "/" && next === "/") break;

      if (char === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }

      if (char === "'" || char === '"' || char === "`") {
        const end = closeQuote(raw, i);
        if (end !== -1) {
          // The quotes stay and the contents go, so a renamed URL keeps its shape.
          code += char + char;
          i = end;
          continue;
        }
      }

      code += char;
      i++;
    }

    const text = code.replace(/\s+/g, " ").trim();
    if (text.length > 0) out.push({ line: index + 1, text });
  });

  return out;
}

/**
 * Comment sentences worth comparing. Contiguous `//` runs and each `/* *\/` block are
 * joined before splitting, so a sentence wrapped across lines is still one sentence.
 */
export function commentSentences(file: string, source: string): Sentence[] {
  const lines = source.split("\n");
  const blocks: { line: number; text: string }[] = [];
  let current: { line: number; parts: string[] } | null = null;
  let inBlockComment = false;

  const flush = () => {
    if (current && current.parts.length > 0) {
      blocks.push({ line: current.line, text: current.parts.join(" ") });
    }
    current = null;
  };

  lines.forEach((raw, i) => {
    const trimmed = raw.trim();

    if (inBlockComment) {
      const close = trimmed.indexOf("*/");
      const body = close === -1 ? trimmed : trimmed.slice(0, close);
      current?.parts.push(body.replace(/^\*+ ?/, ""));
      if (close !== -1) {
        inBlockComment = false;
        flush();
      }
      return;
    }

    if (trimmed.startsWith("/*")) {
      flush();
      current = { line: i + 1, parts: [] };
      const close = trimmed.indexOf("*/");
      const body = close === -1 ? trimmed.slice(2) : trimmed.slice(2, close);
      current.parts.push(body.replace(/^\*+ ?/, ""));
      if (close === -1) inBlockComment = true;
      else flush();
      return;
    }

    if (trimmed.startsWith("//")) {
      if (!current) current = { line: i + 1, parts: [] };
      current.parts.push(trimmed.replace(/^\/+ ?/, ""));
      return;
    }

    flush();
  });
  flush();

  const sentences: Sentence[] = [];
  for (const block of blocks) {
    for (const piece of block.text.split(/(?<=[.?!])\s+/)) {
      const text = piece.replace(/\s+/g, " ").trim();
      if (text.length >= MIN_SENTENCE_CHARS && isProse(text)) {
        sentences.push({ file, line: block.line, text });
      }
    }
  }
  return sentences;
}

function hashWindow(lines: readonly CodeLine[], start: number, size: number): string {
  const body = lines
    .slice(start, start + size)
    .map((l) => l.text)
    .join("\n");
  return createHash("sha1").update(body).digest("hex");
}

/**
 * Merge windows that slid one line at a time over the same duplicated region, so a
 * 30-line copy reports as one pair rather than twenty-five.
 */
export function mergeRuns(pairs: readonly StructuralPair[], size: number): StructuralPair[] {
  const sorted = [...pairs].sort(
    (a, b) =>
      a.changed.file.localeCompare(b.changed.file) ||
      a.other.file.localeCompare(b.other.file) ||
      a.changed.index - b.changed.index,
  );

  const merged: StructuralPair[] = [];
  for (const pair of sorted) {
    const last = merged[merged.length - 1];
    const contiguous =
      last !== undefined &&
      last.changed.file === pair.changed.file &&
      last.other.file === pair.other.file &&
      pair.changed.index <= last.changed.index + last.lines - size + 1 &&
      pair.changed.index - last.changed.index === pair.other.index - last.other.index;

    if (contiguous) {
      merged[merged.length - 1] = {
        changed: { ...last.changed, endLine: pair.changed.endLine },
        other: { ...last.other, endLine: pair.other.endLine },
        lines: pair.changed.index - last.changed.index + size,
      };
    } else {
      merged.push(pair);
    }
  }
  return merged;
}

/** Comment sentences that appear verbatim somewhere else, with one side a changed file. */
function textualPairs(
  sources: ReadonlyMap<string, string>,
  changed: ReadonlySet<string>,
): TextualPair[] {
  const index = new Map<string, Sentence[]>();
  for (const [file, source] of sources) {
    for (const sentence of commentSentences(file, source)) {
      const bucket = index.get(sentence.text);
      if (bucket) bucket.push(sentence);
      else index.set(sentence.text, [sentence]);
    }
  }

  const seen = new Set<string>();
  const pairs: TextualPair[] = [];
  for (const [text, occurrences] of index) {
    if (occurrences.length < 2) continue;
    for (const a of occurrences) {
      if (!changed.has(a.file)) continue;
      for (const b of occurrences) {
        if (a === b) continue;
        // Same-file repetition counts — that is where most of this repo's real
        // duplication lived. What does not count is one comment block matching itself:
        // every sentence lifted from a block carries that block's start line.
        if (a.file === b.file && a.line === b.line) continue;
        // Order the two ends by (file, line) as a tuple. Sorting a mixed string/number
        // array instead compared "12" against "3" lexicographically, so the two
        // orderings of one pair produced different keys — and the second was dropped.
        const [first, second] =
          a.file < b.file || (a.file === b.file && a.line <= b.line) ? [a, b] : [b, a];
        const key = `${first.file}:${first.line}|${second.file}:${second.line}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ a, b, text });
      }
    }
  }
  return pairs;
}

/** Identical normalised windows, with one side a changed file. */
function structuralPairs(
  normalised: ReadonlyMap<string, readonly CodeLine[]>,
  changed: ReadonlySet<string>,
  options: ScanOptions,
): StructuralPair[] {
  const windowIndex = new Map<string, Window[]>();
  for (const [file, lines] of normalised) {
    for (let i = 0; i + options.minLines <= lines.length; i++) {
      const slice = lines.slice(i, i + options.minLines);
      const chars = slice.reduce((sum, l) => sum + l.text.length, 0);
      if (chars < options.minChars) continue;
      const window: Window = {
        file,
        index: i,
        startLine: slice[0].line,
        endLine: slice[slice.length - 1].line,
      };
      const hash = hashWindow(lines, i, options.minLines);
      const bucket = windowIndex.get(hash);
      if (bucket) bucket.push(window);
      else windowIndex.set(hash, [window]);
    }
  }

  const raw: StructuralPair[] = [];
  const seen = new Set<string>();
  for (const windows of windowIndex.values()) {
    if (windows.length < 2) continue;
    for (const a of windows) {
      if (!changed.has(a.file)) continue;
      for (const b of windows) {
        if (a === b) continue;
        // Same-file repetition counts, but only between windows that do not overlap.
        if (a.file === b.file && Math.abs(a.index - b.index) < options.minLines) continue;
        const key =
          a.file < b.file || (a.file === b.file && a.index < b.index)
            ? `${a.file}:${a.index}|${b.file}:${b.index}`
            : `${b.file}:${b.index}|${a.file}:${a.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push({ changed: a, other: b, lines: options.minLines });
      }
    }
  }

  return mergeRuns(raw, options.minLines).sort((a, b) => b.lines - a.lines);
}

/**
 * Both detectors over an in-memory corpus. Pure: `main` does the git and filesystem work
 * and the formatting, this does the finding, and the tests drive it from inline fixtures.
 */
export function scan(
  sources: ReadonlyMap<string, string>,
  changed: ReadonlySet<string>,
  options: ScanOptions,
): ScanResult {
  const normalised = new Map<string, readonly CodeLine[]>();
  for (const [file, source] of sources) normalised.set(file, normalise(source));

  return {
    textual: textualPairs(sources, changed),
    structural: structuralPairs(normalised, changed, options),
    normalised,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const tracked = trackedSourceFiles();

  const named = options.all
    ? tracked
    : options.files.length > 0
      ? options.files
      : changedAgainstMain();
  const requested = named.filter(isSource);

  // The corpus is the tracked tree plus whatever was named, so an uncommitted file is
  // compared against everything and everything is compared against it.
  const sources = new Map<string, string>();
  for (const file of [...tracked, ...requested]) {
    if (sources.has(file)) continue;
    try {
      sources.set(file, readFileSync(file, "utf8"));
    } catch {
      // Listed by git but absent from the working tree (mid-rebase, sparse checkout), or
      // a path the caller mistyped. Either way it is reported below, never swallowed.
    }
  }

  const changed = requested.filter((f) => sources.has(f));
  const discarded = named.filter((f) => !sources.has(f));

  if (changed.length === 0) {
    if (named.length === 0) {
      console.log("No changed .ts/.tsx files against main — nothing to do.");
      return;
    }
    // Every path the caller gave was thrown away. That is a misuse, not a clean result,
    // and an empty report reads exactly like a clean one — so this goes to stderr and
    // the report is not printed at all.
    console.error("");
    console.error("!! DUPLICATION SCAN COMPARED NOTHING.");
    console.error(`!! All ${named.length} path(s) given were unreadable or not .ts/.tsx:`);
    for (const file of discarded) console.error(`!!   ${file}`);
    console.error("!! Paths are relative to the repo root and split on spaces or commas:");
    console.error('!!   npm run duplication -- "lib/services/atlas.ts components/ui/popover.tsx"');
    console.error("");
    console.log("# Duplication scan\n\nNot run — see stderr. No files were compared.");
    return;
  }

  const { textual, structural, normalised } = scan(sources, new Set(changed), options);

  console.log("# Duplication scan\n");
  console.log(
    `Compared ${changed.length} changed file${changed.length === 1 ? "" : "s"} against ` +
      `${sources.size} source files.`,
  );
  if (discarded.length > 0) console.log(`Skipped (unreadable or not source): ${discarded.join(", ")}`);
  console.log("");

  console.log(`## Repeated comment sentences (${textual.length})\n`);
  if (textual.length === 0) {
    console.log("None.\n");
  } else {
    for (const { a, b, text } of textual) {
      console.log(`- ${a.file}:${a.line} <-> ${b.file}:${b.line}`);
      if (!options.quiet) console.log(`    "${text}"`);
    }
    console.log("");
  }

  const inSource = structural.filter((p) => !isTest(p.changed.file) && !isTest(p.other.file));
  const inTests = structural.filter((p) => isTest(p.changed.file) || isTest(p.other.file));

  const printPair = (pair: StructuralPair) => {
    console.log(
      `- ${pair.changed.file}:${pair.changed.startLine}-${pair.changed.endLine} <-> ` +
        `${pair.other.file}:${pair.other.startLine}-${pair.other.endLine}  (${pair.lines} lines)`,
    );
    if (options.quiet) return;
    const lines = normalised.get(pair.changed.file) ?? [];
    const from = lines.findIndex((l) => l.line === pair.changed.startLine);
    for (const l of lines.slice(from, from + Math.min(pair.lines, 4))) {
      console.log(`    ${l.text}`);
    }
    if (pair.lines > 4) console.log("    ...");
  };

  console.log(`## Repeated code shapes (${inSource.length})\n`);
  if (inSource.length === 0) console.log("None.\n");
  else {
    inSource.forEach(printPair);
    console.log("");
  }

  console.log(`## Repeated code shapes in tests (${inTests.length})\n`);
  if (inTests.length === 0) console.log("None.\n");
  else {
    inTests.forEach(printPair);
    console.log("");
  }

  console.log(
    "Every pair above is a candidate, not a finding. Two files can share a shape and still " +
      "be two different things — judge each against the bar in AGENTS.md (same decision, same " +
      "medium, same lifecycle, same posture) before extracting anything.",
  );
}

// Guarded so the detectors below can be imported by their tests without running a scan.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();
