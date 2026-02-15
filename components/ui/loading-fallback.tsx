interface LoadingFallbackProps {
  message?: string;
  className?: string;
}

export function LoadingFallback({
  message = "Loading...",
  className = "",
}: LoadingFallbackProps) {
  return (
    <div
      className={`flex items-center justify-center py-12 ${className}`}
      role="status"
    >
      <div className="text-center space-y-3">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        <p className="text-sm text-white/60">{message}</p>
      </div>
    </div>
  );
}
