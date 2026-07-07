import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./fetcher";

/** Creates a QueryClient with project-wide defaults. */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx failures are deterministic (e.g. 409 "no world loaded") — a
        // retry can't succeed, it only delays the error boundary. Retry once
        // for anything that could be transient (network, 5xx).
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof ApiError && error.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}
