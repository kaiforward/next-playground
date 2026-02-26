interface StatListProps {
  children: React.ReactNode;
  className?: string;
}

/** Semantic description list wrapper for key-value pairs. */
export function StatList({ children, className }: StatListProps) {
  return (
    <dl className={`space-y-4 ${className ?? ""}`}>
      {children}
    </dl>
  );
}

interface StatRowProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/** A single key-value row within a StatList. */
export function StatRow({ label, children, className }: StatRowProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <dt className="text-sm text-text-tertiary shrink-0">{label}</dt>
      <span className="flex-1 border-b border-dotted border-border" />
      <dd className="shrink-0">{children}</dd>
    </div>
  );
}
