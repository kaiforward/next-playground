/**
 * Setup for the `component` project (jsdom). Registers the jest-dom matchers —
 * `toBeInTheDocument`, `toHaveAttribute`, `toHaveAccessibleName` and friends — which are what
 * makes an assertion read as the contract rather than as markup.
 *
 * Testing Library's automatic cleanup between tests registers itself off `globals: true` in
 * `vitest.config.ts`; it is not repeated here. If globals are ever turned off, rendered trees
 * start leaking between tests and `cleanup()` has to be wired up explicitly.
 */
import "@testing-library/jest-dom/vitest";
