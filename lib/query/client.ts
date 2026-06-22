import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { isAuthError } from "./fetcher";

/**
 * Redirects to login on an auth failure (401). After a universe re-seed the JWT
 * cookie outlives the player it points to, so in-flight queries start 401-ing
 * with no hard navigation to re-run the server-side gate. `signOut` clears the
 * dead cookie and sends the user to `/login`. The module-level guard collapses
 * the storm of simultaneous 401s (every query fails at once) into one redirect.
 */
let redirecting = false;
function handleAuthError(error: unknown) {
  if (typeof window === "undefined" || redirecting || !isAuthError(error)) return;
  redirecting = true;
  void signOut({ redirectTo: "/login" });
}

/** Creates a QueryClient with project-wide defaults. */
export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleAuthError }),
    mutationCache: new MutationCache({ onError: handleAuthError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
