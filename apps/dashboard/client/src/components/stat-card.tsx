import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  delta: string;
  deltaPositive: boolean;
  icon: LucideIcon;
  subtitle?: string;
}

export function StatCard({ title, value, delta, deltaPositive, icon: Icon, subtitle }: StatCardProps) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300"
      data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100">
          <Icon className="h-4 w-4 text-gray-700" />
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            deltaPositive
              ? "text-emerald-600 bg-emerald-50"
              : "text-red-600 bg-red-50"
          }`}
        >
          {delta}
        </span>
      </div>
      <p className="text-2xl font-semibold text-foreground tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{title}</p>
      {subtitle && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{subtitle}</p>}
    </div>
  );
}
