/**
 * Task 9 moved the real panel shell (DetailPanel + tabs + existence check) into
 * `components/panels/system-panel.tsx`, which each page below renders directly — this layout is
 * left as a pure passthrough so the route tree still compiles under `next build --webpack` (the
 * build gate stays green through Task 14, which deletes this whole tree). Not spending effort
 * making this layout behave like before (persisting `DetailPanel` across tab navigation): the Next
 * runtime already doesn't function on this branch (hooks read the store, not fetch) — compile-green
 * is the bar.
 */
export default function SystemPanelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
