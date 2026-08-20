/**
 * The wouter side of the link seam (`components/ui/link-provider.tsx`) — mounted by
 * `client/main.tsx`, never imported from `components/ui` itself, so the still-live
 * Next build never pulls wouter's runtime into a component that never renders it there.
 *
 * Adapts wouter's `Link` (which accepts a much richer prop set — `to`, `replace`, `state`, `asChild`,
 * every anchor attribute) down to the shared `LinkComponentProps` contract, the same way
 * `NextLinkAdapter` narrows `next/link` in `link-provider.tsx`. wouter's `Link` renders an `<a>` and
 * intercepts its click to call `history.pushState`/`replaceState` instead of letting the browser
 * navigate — the mechanism `Button`/`TabLink`/`BackLink` link-mode gets "for free" once this
 * component is what `useLinkComponent()` resolves to.
 */
import type { ReactNode } from "react";
import { Link as WouterLink, useLocation, useSearch } from "wouter";
import {
  LinkProvider,
  NavigateProvider,
  RouteInfoProvider,
  type LinkComponent,
} from "@/components/ui/link-provider";

export const WouterLinkAdapter: LinkComponent = function WouterLinkAdapter({
  href,
  className,
  children,
  ...rest
}) {
  return (
    <WouterLink href={href} className={className} {...rest}>
      {children}
    </WouterLink>
  );
};

/**
 * The single mount point the Vite shell (`client/main.tsx`) wraps its whole tree in — supplies all
 * three router-agnostic seams `link-provider.tsx` defines (Link, Navigate, RouteInfo) from wouter's
 * own hooks, rather than three separate providers each call site would otherwise have to remember to
 * nest in the right order. `useLocation()`'s own `navigate` (its second tuple element) is already
 * `(to: string, options?: { replace?: boolean }) => void` — the exact `NavigateFunction` shape
 * `link-provider.tsx` declares, so no adapting needed there (unlike `Link`, which needs its own
 * component-level narrowing above).
 */
export function WouterRuntimeProvider({ children }: { children: ReactNode }) {
  const [pathname, navigate] = useLocation();
  const search = useSearch();
  return (
    <LinkProvider component={WouterLinkAdapter}>
      <NavigateProvider navigate={navigate}>
        <RouteInfoProvider value={{ pathname, searchParams: new URLSearchParams(search) }}>
          {children}
        </RouteInfoProvider>
      </NavigateProvider>
    </LinkProvider>
  );
}
