"use client";

import { Button } from "@/components/ui/button";

interface LoadMoreFooterProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function LoadMoreFooter({
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: LoadMoreFooterProps) {
  if (!hasNextPage) return null;

  return (
    <div className="flex justify-center mt-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onLoadMore}
        disabled={isFetchingNextPage}
      >
        {isFetchingNextPage ? "Loading..." : "Load more"}
      </Button>
    </div>
  );
}
