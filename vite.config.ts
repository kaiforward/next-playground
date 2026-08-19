import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config for the client-only shell (client-runtime spec §7, §9; build plan Task 6). `root:
 * "client"` — `client/index.html` is the entry document, `client/main.tsx` the entry module. The
 * `@/*` alias mirrors `tsconfig.json`'s `paths` so `lib/`, `components/` and `app/globals.css`
 * resolve identically to the Next build; it is set to the PROJECT root (not `client/`) so `@/lib/…`
 * keeps working regardless of where Vite's own root sits.
 *
 * `worker.format: "es"` matches `client/worker/entry.ts`'s use of dynamic `import()` — a classic
 * (non-module) worker cannot use ESM imports, and the worker entry's whole boot seam (spec §6) is
 * built on a dynamic `import()` running after the boot-config global is set.
 *
 * `process.env.NODE_ENV` is set explicitly here rather than relied on implicitly: three components
 * (`app/layout.tsx`, `components/game-shell.tsx`, `components/dev-tools/axe-accessibility.tsx`, per
 * spec §6) read it at render and move to this define at Task 10 — stated here so the seam exists
 * before that task needs it, rather than discovered as a build break then.
 */

/**
 * `lib/world/save-files.ts` (Node's disk-backed `SaveBackend`; `lib/world/tick-loop.ts`'s
 * dynamic-imported autosave path, `tick-loop.ts:281`) is reachable from the WORKER's module graph
 * even though it only ever runs under Node — `new Worker(new URL("./worker/entry.ts", ...))` gives
 * the worker entry its own Rollup sub-build (`worker.plugins` below), and a dynamic `import()` still
 * makes Rollup trace and bundle what it points at for a production build; it does not exempt a
 * module from bundling, only from the initial chunk.
 *
 * Vite's own `vite:resolve` plugin intercepts `node:*` specifiers first and rewrites them to an
 * empty browser-compat shim with no named exports — that shim is what turns `save-files.ts`'s named
 * imports from `node:fs/promises`/`node:path` into a hard build error. This plugin runs BEFORE that
 * (`enforce: "pre"`) and marks `node:*` imports external itself, leaving them unresolved verbatim in
 * the emitted chunk instead of erroring. Needed on BOTH the main build and the worker sub-build
 * (`worker.plugins`) — Vite does not share the top-level `plugins` list with the worker bundle.
 *
 * This is a stated Task 6 judgment call, not the real fix: the actual fix is
 * `client/save-indexeddb.ts`, the browser `SaveBackend` Task 12 adds, at which point the web bundle
 * stops reaching `save-files.ts` at all (a browser `SaveBackend` implementation, not the Node one)
 * and both this plugin and the `rollupOptions.external` below can come out.
 *
 * The trap this leaves live until then: marking EVERY `node:*` specifier external is coarser than
 * the one reachable case above — a genuinely mistaken `node:*` import added to other client code
 * would also silently pass this plugin instead of failing the build, and only announce itself as a
 * runtime crash in the browser (the bare specifier left unresolved in the shipped chunk). There is
 * no narrower target available (the plugin only sees the specifier, not which module is asking for
 * it), so this is accepted as part of the same judgment call, not a separate gap — Task 12 removing
 * the plugin removes the trap too.
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
