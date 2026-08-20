"use client";

/**
 * Router-agnostic link seam (client-runtime spec §7, build plan Task 6) — `Button`, `TabLink` and
 * `BackLink` render whatever component this context holds instead of hard-coding `next/link`. The
 * DEFAULT is `next/link` itself, wrapped in `NextLinkAdapter` below: under the Next.js app (unchanged
 * until Task 14 deletes it) nothing mounts a `LinkProvider`, so `useLinkComponent()` returns the
 * default and every link-rendering component is byte-identical to before this file existed. The Vite
 * shell (`client/main.tsx`) mounts a `LinkProvider` supplying a wouter-backed adapter
 * (`client/wouter-link.tsx` — kept out of this file so `components/ui` never imports `wouter`, which
 * would otherwise ship wouter's runtime into the still-live Next bundle for a component that never
 * renders it there).
 *
 * The seam is a plain prop contract (`LinkComponentProps`), not each library's own richer `LinkProps`
 * — only what `Button`/`TabLink`/`BackLink` actually pass (`href`, `className`, `children`, and the
 * two ARIA attributes `TabLink`/`BackLink` set) is in the contract, so swapping the implementation can
 * never silently drop a prop neither adapter forwards.
 *
 * Task 9 extends the same file with two more router-agnostic seams — `useNavigate()` (programmatic
 * navigation: `DetailPanel`'s close, `use-system-focus.ts`'s fly-to, `star-map.tsx`'s click handlers,
 * `alert-run.tsx`'s flyout row activation, none of which are a `<Link>` click) and `useRouteInfo()`
 * (the current pathname + query params `star-map.tsx` reads for selection/camera state). Both follow
 * the exact shape above: a context with a harmless Next-side default (no `NavigateProvider`/
 * `RouteInfoProvider` is mounted under the old Next app, so both read as inert there — acceptable
 * because the Next runtime only has to compile on this branch, not behave, per the build plan), and a
 * real implementation the Vite shell supplies (`client/wouter-link.tsx`'s `WouterRuntimeProvider`,
 * backed by wouter's `useLocation`/`useSearch`).
 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import NextLink from "next/link";

export interface LinkComponentProps {
  href: string;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page" | undefined;
}

export type LinkComponent = ComponentType<LinkComponentProps>;

/** `next/link` narrowed to the shared contract — the seam's default, and what every consumer of
 *  these three components gets today with no `LinkProvider` mounted (the Next app's case). */
const NextLinkAdapter: LinkComponent = function NextLinkAdapter({
  href,
  className,
  children,
  ...rest
}) {
  return (
    <NextLink href={href} className={className} {...rest}>
      {children}
    </NextLink>
  );
};

const LinkComponentContext = createContext<LinkComponent>(NextLinkAdapter);

export function LinkProvider({
  component,
  children,
}: {
  component: LinkComponent;
  children: ReactNode;
}) {
  return (
    <LinkComponentContext.Provider value={component}>{children}</LinkComponentContext.Provider>
  );
}

export function useLinkComponent(): LinkComponent {
  return useContext(LinkComponentContext);
}

/* ------------------------------------------------------------------ */
/*  Programmatic navigation seam                                       */
/* ------------------------------------------------------------------ */

export type NavigateFunction = (path: string, options?: { replace?: boolean }) => void;

/** The Next-side default: no `NavigateProvider` is mounted under the old Next app (Task 9 moves
 *  every caller of programmatic navigation onto this seam, and nothing re-wires the Next app to
 *  supply a real implementation — that app only has to compile after this task, not navigate). */
const noopNavigate: NavigateFunction = () => {};

const NavigateContext = createContext<NavigateFunction>(noopNavigate);

export function NavigateProvider({
  navigate,
  children,
}: {
  navigate: NavigateFunction;
  children: ReactNode;
}) {
  return <NavigateContext.Provider value={navigate}>{children}</NavigateContext.Provider>;
}

export function useNavigate(): NavigateFunction {
  return useContext(NavigateContext);
}

/* ------------------------------------------------------------------ */
/*  Current-route seam (pathname + query params)                       */
/* ------------------------------------------------------------------ */

export interface RouteInfo {
  pathname: string;
  searchParams: URLSearchParams;
}

const defaultRouteInfo: RouteInfo = { pathname: "/", searchParams: new URLSearchParams() };

const RouteInfoContext = createContext<RouteInfo>(defaultRouteInfo);

export function RouteInfoProvider({
  value,
  children,
}: {
  value: RouteInfo;
  children: ReactNode;
}) {
  return <RouteInfoContext.Provider value={value}>{children}</RouteInfoContext.Provider>;
}

export function useRouteInfo(): RouteInfo {
  return useContext(RouteInfoContext);
}
