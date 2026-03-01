interface StatPairProps {
  label: string;
  value: number;
}

export function StatPair({ label, value }: StatPairProps) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-sm text-text-tertiary">{label}</span>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}
