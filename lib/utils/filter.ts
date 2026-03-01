/**
 * Augment filter chips with item counts.
 *
 * The first chip (typically "all") always gets the total item count.
 * Remaining chips count how many items belong to their category.
 */
export function withCounts<T>(
  chips: readonly { id: string; label: string }[],
  items: T[],
  getCategory: (item: T) => string,
): { id: string; label: string; count: number }[] {
  return chips.map((chip, i) => ({
    ...chip,
    count:
      i === 0
        ? items.length
        : items.filter((item) => getCategory(item) === chip.id).length,
  }));
}
