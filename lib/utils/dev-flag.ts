/**
 * True in a development build (client-runtime spec §6; build plan Task 10).
 *
 * Prefers Vite's real flag (`import.meta.env.DEV`); the `process.env.NODE_ENV` fallback is what
 * `vite.config.ts`'s `define` block substitutes at build time for the same value, kept so the
 * expression stays well-formed even where `import.meta.env` is read before Vite's replacement runs.
 * A PRODUCTION build dead-code-eliminates whatever branch this guards (the Task 10 bundle-grep
 * proof depends on this).
 */
export function isDevBuild(): boolean {
  return import.meta.env?.DEV ?? process.env.NODE_ENV === "development";
}
