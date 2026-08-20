"use client";

/**
 * Router-agnostic link seam (client-runtime spec §7, build plan Task 6) — `Button`, `TabLink` and
 * `BackLink` render whatever component this context holds instead of hard-coding a router's link
 * component. The Vite shell (`client/main.tsx`) always mounts a `LinkProvider` supplying a
 * wouter-backed adapter (`client/wouter-link.tsx` — kept out of this file so `components/ui` never
 * imports `wouter`) — the styleguide route renders inside that same `WouterRuntimeProvider`
 * (`client/main.tsx`'s `App`), so it never sees the default either. The DEFAULT below (a plain
 * anchor) is exercised only by an isolated component test that renders `Button`/`TabLink`/
 * `BackLink` with no `LinkProvider` mounted.
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
 * the exact shape above: a context with a harmless no-op default (exercised only where no
 * `NavigateProvider`/`RouteInfoProvider` is mounted), and a real implementation the Vite shell
 * supplies (`client/wouter-link.tsx`'s `WouterRuntimeProvider`, backed by wouter's
 * `useLocation`/`useSearch`).
 */
import { createContext, useContext, type ComponentType, type CSSProperties, type ReactNode } from "react";

export interface LinkComponentProps {
  href: string;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page" | undefined;
  /** `TopBar`'s faction flag (`components/top-bar.tsx`) needs a native tooltip + the faction's
   *  colour as an inline style — both adapters already spread unrecognised props through to their
   *  underlying anchor, so adding these here is the only change either adapter needs. */
  title?: string;
  style?: CSSProperties;
}

export type LinkComponent = ComponentType<LinkComponentProps>;

/** A plain anchor narrowed to the shared contract — the seam's default, and what every consumer of
 *  these three components gets with no `LinkProvider` mounted (isolated tests, styleguide). */
const AnchorLinkAdapter: LinkComponent = function AnchorLinkAdapter({
  href,
  className,
  children,
  ...rest
}) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
};

const LinkComponentContext = createContext<LinkComponent>(AnchorLinkAdapter);

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

/** The seam's default: a no-op, exercised only where no `NavigateProvider` is mounted (isolated
 *  tests, styleguide). */
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
