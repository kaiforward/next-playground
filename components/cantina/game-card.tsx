"use client";

import type { ReactNode } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import type { Card, Declaration } from "@/lib/engine/mini-games/voids-gambit";
import { SUIT_LABELS } from "@/lib/engine/mini-games/voids-gambit";
import { suitTheme } from "./suit-styles";

// ── Variants ─────────────────────────────────────────────────────

const gameCardVariants = tv({
  base: "relative flex flex-col items-center justify-center rounded-lg border transition-all select-none",
  variants: {
    size: {
      sm: "w-[5.5rem] h-[7.5rem] text-sm",
      md: "w-32 h-[10.5rem] text-base",
    },
    selectable: {
      true: "cursor-pointer hover:scale-105 hover:ring-1 hover:ring-white/30",
      false: "",
    },
    selected: {
      true: "ring-2 ring-cyan-400 scale-105",
      false: "",
    },
    caught: {
      true: "ring-2 ring-red-500/70 opacity-60",
      false: "",
    },
  },
  defaultVariants: {
    size: "md",
    selectable: false,
    selected: false,
    caught: false,
  },
});

const cardValueVariants = tv({
  base: "font-bold",
  variants: {
    size: {
      sm: "text-xl",
      md: "text-3xl",
    },
  },
  defaultVariants: { size: "md" },
});

const cardSuitVariants = tv({
  base: "leading-tight text-center",
  variants: {
    size: {
      sm: "text-xs",
      md: "text-sm",
    },
  },
  defaultVariants: { size: "md" },
});

const declaredBadgeVariants = tv({
  base: "absolute left-1/2 -translate-x-1/2 bg-slate-800 border border-white/15 rounded-md whitespace-nowrap",
  variants: {
    size: {
      sm: "-bottom-4 px-2 py-0.5",
      md: "-bottom-5 px-2.5 py-1",
    },
  },
  defaultVariants: { size: "md" },
});

const declaredBadgeTextVariants = tv({
  base: "font-bold",
  variants: {
    size: {
      sm: "text-xs",
      md: "text-sm",
    },
  },
  defaultVariants: { size: "md" },
});

// ── Props ────────────────────────────────────────────────────────

type GameCardVariants = VariantProps<typeof gameCardVariants>;

interface GameCardProps {
  card?: Card;
  face: "up" | "down";
  declaration?: Declaration;
  size?: GameCardVariants["size"];
  isSelected?: GameCardVariants["selected"];
  isSelectable?: GameCardVariants["selectable"];
  isCaught?: GameCardVariants["caught"];
  onClick?: () => void;
}

// ── Component ────────────────────────────────────────────────────

export function GameCard({
  card,
  face,
  declaration,
  size = "md",
  isSelected = false,
  isSelectable = false,
  isCaught = false,
  onClick,
}: GameCardProps) {
  const shellProps = { size, isSelectable, isSelected, isCaught, onClick };

  // Face-down card
  if (face === "down") {
    return (
      <CardShell {...shellProps} bgClassName="bg-surface-active border-border-strong">
        {declaration ? (
          <DeclarationOverlay declaration={declaration} isCaught={isCaught} />
        ) : (
          <div className="text-white/20 text-xs font-bold">?</div>
        )}
      </CardShell>
    );
  }

  // Void card (face up)
  if (card?.type === "void") {
    return (
      <CardShell {...shellProps} bgClassName="bg-slate-900 border-slate-500/40">
        <span className="text-slate-400 font-bold text-sm uppercase tracking-wider">
          Void
        </span>
        {declaration && (
          <DeclaredAsBadge declaration={declaration} size={size} />
        )}
        {isCaught && <CaughtStrike />}
      </CardShell>
    );
  }

  // Standard card (face up) — suit is guaranteed (void/face-down handled above)
  const suit = card?.suit;
  if (!suit) return null;

  const theme = suitTheme({ suit });

  const showDeclared =
    declaration &&
    (card?.suit !== declaration.suit || card?.value !== declaration.value);

  return (
    <CardShell {...shellProps} bgClassName={theme.card()}>
      <span className={cardValueVariants({ size, className: theme.text() })}>
        {card?.value}
      </span>
      <span className={cardSuitVariants({ size, className: theme.text() })}>
        {SUIT_LABELS[suit]}
      </span>
      {showDeclared && (
        <DeclaredAsBadge declaration={declaration} size={size} />
      )}
      {isCaught && <CaughtStrike />}
    </CardShell>
  );
}

// ── Internal shell ───────────────────────────────────────────────

interface CardShellProps {
  size: GameCardVariants["size"];
  isSelectable: GameCardVariants["selectable"];
  isSelected: GameCardVariants["selected"];
  isCaught: GameCardVariants["caught"];
  onClick?: () => void;
  bgClassName: string;
  children: ReactNode;
}

function CardShell({
  size,
  isSelectable,
  isSelected,
  isCaught,
  onClick,
  bgClassName,
  children,
}: CardShellProps) {
  return (
    <button
      type="button"
      disabled={!isSelectable}
      className={gameCardVariants({
        size,
        selectable: isSelectable,
        selected: isSelected,
        caught: isCaught,
        className: bgClassName,
      })}
      onClick={isSelectable ? onClick : undefined}
    >
      {children}
    </button>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function DeclarationOverlay({
  declaration,
  isCaught,
}: {
  declaration: Declaration;
  isCaught: boolean;
}) {
  const textClass = suitTheme({ suit: declaration.suit }).text();

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`font-bold text-xl ${textClass} ${isCaught ? "line-through" : ""}`}>
        {declaration.value}
      </span>
      <span className={`text-xs ${textClass} opacity-70`}>
        {SUIT_LABELS[declaration.suit]}
      </span>
    </div>
  );
}

function DeclaredAsBadge({
  declaration,
  size,
}: {
  declaration: Declaration;
  size: "sm" | "md";
}) {
  const textClass = suitTheme({ suit: declaration.suit }).text();

  return (
    <div className={declaredBadgeVariants({ size })}>
      <span className={declaredBadgeTextVariants({ size, className: textClass })}>
        &ldquo;{declaration.value}&rdquo;
      </span>
    </div>
  );
}

function CaughtStrike() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-full h-0.5 bg-red-500/80 rotate-[-20deg]" />
    </div>
  );
}
