import { tv } from "tailwind-variants";
import type { EconomyType } from "@/lib/types/game";

const economyBadgeVariants = tv({
  base: "inline-block px-3 py-0.5 text-xs font-semibold uppercase tracking-wider ring-1",
  variants: {
    economyType: {
      agricultural: "bg-green-900/80 text-green-300 ring-green-500/40",
      extraction: "bg-amber-900/80 text-amber-300 ring-amber-500/40",
      refinery: "bg-cyan-900/80 text-cyan-300 ring-cyan-500/40",
      industrial: "bg-slate-700/80 text-slate-300 ring-slate-400/40",
      tech: "bg-blue-900/80 text-blue-300 ring-blue-500/40",
      core: "bg-purple-900/80 text-purple-300 ring-purple-500/40",
    },
  },
});

interface EconomyBadgeProps {
  economyType: EconomyType;
  className?: string;
}

export function EconomyBadge({ economyType, className }: EconomyBadgeProps) {
  return (
    <span className={economyBadgeVariants({ economyType, className })}>
      {economyType}
    </span>
  );
}
