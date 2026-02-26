export function TabCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-surface-active text-[11px] font-medium text-white/60 leading-1">
      {count}
    </span>
  );
}
