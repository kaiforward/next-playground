import { TermLabel } from "@/components/ui/term-label";

/**
 * The one-line consequence sentence closing a need popover — shared verbatim by the Industry
 * pop-pressure chip (`industry-panel.tsx`) and the population Provision ledger's per-need dwell
 * popover (`need-popover-body.tsx`), so the two can't drift back into two different wordings of
 * the same fact.
 */
export function UnmetNeedConsequences() {
  return (
    <p className="border-t border-border/60 pt-1 text-text-secondary">
      Doing worse than this <TermLabel id="population">population</TermLabel> is used to breeds{" "}
      <TermLabel id="unrest">unrest</TermLabel> — <TermLabel id="famine">famine</TermLabel> and
      critical shortages always do.
    </p>
  );
}
