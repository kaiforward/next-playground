import { Button } from "@/components/ui/button";
import type { FallbackProps } from "react-error-boundary";

interface ErrorFallbackProps {
  error: Error;
  onRetry: () => void;
}

export function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  return (
    <div className="flex items-center justify-center py-12" role="alert">
      <div className="text-center space-y-3 max-w-sm">
        <p className="text-sm text-red-400">{error.message}</p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/**
 * `react-error-boundary`'s `fallbackRender` prop, pointed at `ErrorFallback` directly — the shared
 * body every panel mount site under `components/panels/**` passes to its own `<ErrorBoundary>`
 * (Task 9, `QueryBoundary` retirement: with hooks now synchronous store reads, panels need only the
 * error half of what `QueryBoundary` bundled, never its `Suspense`/mounted-guard loading half). A
 * function, not a new component — `<ErrorBoundary fallbackRender={renderErrorFallback}>` is still
 * "react-error-boundary directly" per the build plan's interface line, just without twenty-odd call
 * sites hand-writing the same `error instanceof Error` coercion (react-error-boundary v5 types
 * `FallbackProps.error` as `unknown`).
 */
export function renderErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const err = error instanceof Error ? error : new Error(String(error));
  return <ErrorFallback error={err} onRetry={resetErrorBoundary} />;
}

/** The silent counterpart to `renderErrorFallback` — for a mount site whose old `QueryBoundary` set
 *  `errorFallback={() => null}` (a slot that degrades to nothing rather than a visible error card:
 *  `top-bar.tsx`'s treasury cluster, `alert-run.tsx`'s run, `pin-toggle.tsx`'s header slot). */
export function renderNothingFallback() {
  return null;
}
