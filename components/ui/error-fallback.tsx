import { Button } from "@/components/ui/button";

interface ErrorFallbackProps {
  error: Error;
  onRetry: () => void;
}

export function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  return (
    <div className="flex items-center justify-center py-12" role="alert">
      <div className="text-center space-y-3 max-w-sm">
        <p className="text-sm text-red-400">{error.message}</p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
