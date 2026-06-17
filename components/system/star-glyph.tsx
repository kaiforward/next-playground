import { tv, type VariantProps } from "tailwind-variants";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { SUN_CLASS_COLORS } from "@/lib/constants/ui";
import type { SunClass } from "@/lib/types/game";

const glyphVariants = tv({
  base: "inline-block rounded-full shrink-0",
  variants: {
    size: { sm: "h-3 w-3", md: "h-6 w-6" },
  },
  defaultVariants: { size: "md" },
});

type GlyphVariants = VariantProps<typeof glyphVariants>;

interface StarGlyphProps extends GlyphVariants {
  sunClass: SunClass;
  className?: string;
}

/**
 * Colored circular swatch for a sun class. Round by design (it's a star) — the
 * Foundry no-rounding rule targets cards/buttons/badges, not iconography.
 */
export function StarGlyph({ sunClass, size, className }: StarGlyphProps) {
  const color = SUN_CLASS_COLORS[sunClass];
  return (
    <span
      aria-hidden
      title={SUN_CLASSES[sunClass].name}
      className={glyphVariants({ size, className })}
      style={{
        background: `radial-gradient(circle at 35% 35%, ${color}, ${color}99 60%, ${color}33)`,
      }}
    />
  );
}
