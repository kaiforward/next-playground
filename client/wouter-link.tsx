/**
 * The wouter side of the link seam (`components/ui/link-provider.tsx`) — mounted by
 * `client/main.tsx` via `LinkProvider`, never imported from `components/ui` itself, so the still-live
 * Next build never pulls wouter's runtime into a component that never renders it there.
 *
 * Adapts wouter's `Link` (which accepts a much richer prop set — `to`, `replace`, `state`, `asChild`,
 * every anchor attribute) down to the shared `LinkComponentProps` contract, the same way
 * `NextLinkAdapter` narrows `next/link` in `link-provider.tsx`. wouter's `Link` renders an `<a>` and
 * intercepts its click to call `history.pushState`/`replaceState` instead of letting the browser
 * navigate — the mechanism `Button`/`TabLink`/`BackLink` link-mode gets "for free" once this
 * component is what `useLinkComponent()` resolves to.
 */
import { Link as WouterLink } from "wouter";
import type { LinkComponent } from "@/components/ui/link-provider";

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
