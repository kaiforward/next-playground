export function TabCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 bg-surface-active text-[11px] font-medium text-text-secondary leading-1">
      {count}
    </span>
  );
}
