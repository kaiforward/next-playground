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
    <div className={`flex items-center justify-between ${className ?? ""}`}>
      <dt className="text-sm text-white/50">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
