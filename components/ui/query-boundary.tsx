"use client";

import { type ReactNode, Suspense } from "react";
import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { LoadingFallback } from "@/components/ui/loading-fallback";
import { ErrorFallback } from "@/components/ui/error-fallback";

interface QueryBoundaryProps {
  children: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: (props: { error: Error; retry: () => void }) => ReactNode;
}

export function QueryBoundary({
  children,
  loadingFallback,
  errorFallback,
}: QueryBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }) => {
            const err = error instanceof Error ? error : new Error(String(error));
            return errorFallback ? (
              errorFallback({ error: err, retry: resetErrorBoundary })
            ) : (
              <ErrorFallback error={err} onRetry={resetErrorBoundary} />
            );
          }}
        >
          <Suspense fallback={loadingFallback ?? <LoadingFallback />}>
            {children}
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
