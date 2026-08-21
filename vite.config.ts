import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config for the client-only shell (client-runtime spec §7, §9; build plan Task 6). `root:
 * "client"` — `client/index.html` is the entry document, `client/main.tsx` the entry module. The
 * `@/*` alias mirrors `tsconfig.json`'s `paths` so `lib/`, `components/` and `client/globals.css`
 * resolve the same way from any depth; it is set to the PROJECT root (not `client/`) so `@/lib/…`
 * keeps working regardless of where Vite's own root sits.
 *
 * `worker.format: "es"` matches `client/worker/entry.ts`'s use of dynamic `import()` — a classic
 * (non-module) worker cannot use ESM imports, and the worker entry's whole boot seam (spec §6) is
 * built on a dynamic `import()` running after the boot-config global is set.
 *
 * `process.env.NODE_ENV` is set explicitly here rather than relied on implicitly: `lib/utils/dev-
 * flag.ts`'s `isDevBuild()` (build plan Task 10) reads it as its fallback (`components/game-shell.tsx`,
 * `components/dev-tools/axe-accessibility.tsx`) — Vite's `import.meta.env.DEV` is this helper's
 * primary path and is what actually resolves under this bundler, but the fallback expression is
 * still part of the module Vite bundles, so this define keeps it well-formed.
 */

/**
 * `lib/world/save-files.ts` (Node's disk-backed `SaveBackend`) is reachable from the WORKER's
 * module graph even though it only ever RUNS under Node — `new Worker(new URL("./worker/entry.ts",
 * ...))` gives the worker entry its own Rollup sub-build (`worker.plugins` below), and a dynamic
 * `import()` still makes Rollup trace and bundle what it points at for a production build; it does
 * not exempt a module from bundling, only from the initial chunk.
 *
 * Vite's own `vite:resolve` plugin intercepts `node:*` specifiers first and rewrites them to an
 * empty browser-compat shim with no named exports — that shim is what turns `save-files.ts`'s named
 * imports from `node:fs/promises`/`node:path` into a hard build error. This plugin runs BEFORE that
 * (`enforce: "pre"`) and marks `node:*` imports external itself, leaving them unresolved verbatim in
 * the emitted chunk instead of erroring. Needed on BOTH the main build and the worker sub-build
 * (`worker.plugins`) — Vite does not share the top-level `plugins` list with the worker bundle.
 *
 * **Verified still needed at Task 12, RE-VERIFIED at Task 14 after the `app/` deletion (build plan)
 * — NOT removed. The reachability moved, it did not disappear**, and deleting `app/` does not touch
 * it: `client/worker/entry.ts`'s module graph into `lib/services/game.ts` → `save-backend.ts` →
 * the dynamic `import("./save-files")` fallback was never routed through `app/` at all. Re-tested
 * empirically at Task 14 (remove the plugin, `vite build`, same three-line `node:fs/promises`
 * failure as below) rather than assumed. The Task-6 note this docstring used to carry expected
 * `client/save-indexeddb.ts` (the
 * browser `SaveBackend` Task 12 adds) to make this plugin removable; it doesn't, because of WHERE the
 * Node fallback lives. `lib/world/save-backend.ts`'s `getSaveBackend()` — the shared resolution point
 * `lib/services/game.ts`/`lib/world/tick-loop.ts` both call, and the ONLY module that may reach
 * `save-files.ts` at all now (Path-B purity) — keeps a `dynamic import("./save-files")` FALLBACK for
 * every Node host that never explicitly registers a backend (`npm run simulate`, unit tests, the
 * still-alive Next dev server, none of which have a single bootstrap hook to call `setSaveBackend`
 * from). That fallback is provably never TAKEN in the browser (`client/worker/entry.ts` registers
 * the IndexedDB backend synchronously before `createGameWorker` can process a single message), but
 * the `import()` call is still textually present in `save-backend.ts`, which the worker's bundle
 * does reach (`lib/services/game.ts` is the module the worker dynamic-imports at boot) — and Rollup
 * bundles a dynamic import's target into its own chunk from the static module graph regardless of
 * whether that branch is ever reached at runtime (confirmed: removing this plugin still fails the
 * build on `save-files.ts`'s `node:fs/promises` import, same three-line error as before this task).
 * Actually removing the reachability would mean either giving every Node host an explicit boot hook
 * to call `setSaveBackend(nodeSaveBackend)` (a bigger change than this task's scope — see
 * `save-backend.ts`'s header docstring for the design this weighs against), or hiding the specifier
 * from Rollup's static analysis (`/* @vite-ignore *\/`), which trades a verified, obvious failure
 * mode (a real client `node:*` import breaks the build) for a silent one (a real client `node:*`
 * import breaks only at runtime, in the browser) — not a trade this task makes unilaterally.
 *
 * The trap this leaves live: marking EVERY `node:*` specifier external is coarser than the one
 * reachable case above — a genuinely mistaken `node:*` import added to other client code would also
 * silently pass this plugin instead of failing the build, and only announce itself as a runtime
 * crash in the browser (the bare specifier left unresolved in the shipped chunk). There is no
 * narrower target available (the plugin only sees the specifier, not which module is asking for it).
 */
function externalNodeBuiltins(): Plugin {
  return {
    name: "external-node-builtins",
    enforce: "pre",
    resolveId(source: string) {
      if (source.startsWith("node:")) return { id: source, external: true };
      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, "client"),
  publicDir: path.resolve(__dirname, "client", "public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  plugins: [externalNodeBuiltins(), react()],
  worker: {
    format: "es",
    plugins: () => [externalNodeBuiltins()],
    rollupOptions: {
      external: [/^node:/],
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      external: [/^node:/],
    },
  },
}));
