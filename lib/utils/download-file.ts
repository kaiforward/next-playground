/**
 * Triggers a browser file download for in-memory text content — the start screen's Export control
 * (client-runtime build plan Task 12). Pure DOM plumbing (Blob + a throwaway anchor), pulled out of
 * the component so the trigger itself is unit-testable without rendering anything: a component test
 * can only assert roles/names/text (AGENTS.md), and "a file download happened" has no such surface.
 */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
