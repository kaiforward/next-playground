"use client";

import { tv } from "tailwind-variants";

const dotVariants = tv({
  base: "w-1.5 h-1.5 rounded-full",
  variants: {
    active: {
      true: "bg-amber-400",
      false: "bg-white/15",
    },
  },
  defaultVariants: { active: false },
});

interface DifficultyDotsProps {
  level: number;
  showLabel?: boolean;
}

export function DifficultyDots({ level, showLabel = false }: DifficultyDotsProps) {
  const dots = [1, 2, 3].map((i) => (
    <span key={i} className={dotVariants({ active: i <= level })} />
  ));

  if (showLabel) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-text-faint uppercase tracking-wider">
          Difficulty
        </span>
        <span className="inline-flex gap-0.5" aria-label={`level ${level} of 3`}>{dots}</span>
      </div>
    );
  }

  return (
    <span className="inline-flex gap-0.5" aria-label={`Difficulty ${level}`}>
      {dots}
    </span>
  );
}
