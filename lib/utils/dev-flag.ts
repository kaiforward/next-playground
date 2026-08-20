/**
 * True in a development build, under either host (client-runtime spec §6; build plan Task 10).
 *
 * A component built by ONLY the Vite client (e.g. `client/main.tsx`) can read
 * `import.meta.env.DEV` directly — that pattern is already established there. A component built by
 * BOTH the Vite client and the (still live until Task 14) Next/webpack build cannot: `import.meta`
 * is valid syntax under webpack (it never throws on `import.meta.env` — property access on a
 * defined object that merely lacks that key returns `undefined`, not an error), but webpack does
 * not populate `.env`, so the value is never Next's dev/prod signal there. `process.env.NODE_ENV`
 * is the inverse — Next's webpack build replaces it via its own define; Vite's build replaces it
 * too, but only because `vite.config.ts`'s `define` block sets it to match (added at Task 6 for
 * exactly this).
 *
 * This helper prefers Vite's real flag when present and falls back to the value both bundlers'
 * define/replace already substitute at build time, so a PRODUCTION build of either host
 * dead-code-eliminates whatever branch it guards (the Task 10 bundle-grep proof depends on this).
 */
export function isDevBuild(): boolean {
  return import.meta.env?.DEV ?? process.env.NODE_ENV === "development";
}
