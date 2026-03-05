import { ArrowUp, ArrowDown } from "lucide-react";

interface TrendIconProps {
  direction: "up" | "down";
  className?: string;
}

export function TrendIcon({ direction, className }: TrendIconProps) {
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return <Icon className={`w-4 h-4 inline ${className ?? ""}`} />;
}
