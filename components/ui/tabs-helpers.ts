/** One route-backed tab of a detail panel, before its href and active state are worked out. */
export interface PanelTabDef {
  readonly label: string;
  /** Path segment appended after the panel's base path. The empty string is the index tab. */
  readonly segment: string;
}

/** A `PanelTabDef` resolved against a pathname: where it links and whether it is the current tab. */
export interface ResolvedPanelTab {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}

/**
 * Turns a panel's tab definitions into links plus their active state, given the panel's own base
 * path and the current pathname.
 *
 * The two matching rules are deliberately asymmetric, and that asymmetry is the whole reason this
 * lives in one place rather than in each panel's layout:
 *
 *  - the index tab (empty segment) matches the base path EXACTLY. Every other tab's href starts
 *    with the base path, so an index tab matched by prefix would stay lit on every sub-tab.
 *  - a sub-tab matches its own href or anything nested under it, so a future deeper route keeps
 *    its parent tab lit. `${href}/` rather than a bare prefix, so a segment can never light up a
 *    sibling that merely starts with the same letters.
 */
export function resolvePanelTabs(
  basePath: string,
  tabs: readonly PanelTabDef[],
  pathname: string,
): ResolvedPanelTab[] {
  return tabs.map((tab) => {
    const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
    return {
      label: tab.label,
      href,
      active: tab.segment
        ? pathname === href || pathname.startsWith(`${href}/`)
        : pathname === basePath,
    };
  });
}
