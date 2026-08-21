"use client";

import { ArrowLeft } from "lucide-react";
import { useLinkComponent } from "./link-provider";

interface BackLinkProps {
  href: string;
}

export function BackLink({ href }: BackLinkProps) {
  const LinkComponent = useLinkComponent();
  return (
    <LinkComponent
      href={href}
      className="text-text-secondary hover:text-white transition-colors"
      aria-label="Go back"
    >
      <ArrowLeft className="w-5 h-5" />
    </LinkComponent>
  );
}
