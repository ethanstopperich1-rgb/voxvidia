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
      className="rounded-lg border border-[#1e1e1e] bg-[#111] p-4 transition-colors hover:border-[#2a2a2a]"
      data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1a1a1a]">
          <Icon className="h-4 w-4 text-[#d4a843]" />
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            deltaPositive
              ? "text-emerald-400 bg-emerald-400/10"
              : "text-rose-400 bg-rose-400/10"
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
