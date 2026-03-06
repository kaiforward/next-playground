import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface BackLinkProps {
  href: string;
}

export function BackLink({ href }: BackLinkProps) {
  return (
    <Link
      href={href}
      className="text-text-secondary hover:text-white transition-colors"
    >
      <ArrowLeft className="w-5 h-5" />
    </Link>
  );
}
