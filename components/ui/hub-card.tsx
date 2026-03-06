import Link from "next/link";
import { Card } from "./card";

interface HubCardProps {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accentClass: string;
}

export function HubCard({ href, title, description, icon, accentClass }: HubCardProps) {
  return (
    <Link href={href} className="block group">
      <Card variant="bordered" padding="lg" className={`transition-colors ${accentClass}`}>
        <div className="flex items-center gap-4">
          <div className="shrink-0 text-text-secondary group-hover:text-white transition-colors">
            {icon}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            <p className="text-sm text-text-secondary mt-0.5">{description}</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
