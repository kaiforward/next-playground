interface EmptyStateProps {
  message: string;
  className?: string;
}

export function EmptyState({ message, className }: EmptyStateProps) {
  return (
    <p className={`text-text-tertiary text-sm text-center py-6 ${className ?? ""}`}>
      {message}
    </p>
  );
}
