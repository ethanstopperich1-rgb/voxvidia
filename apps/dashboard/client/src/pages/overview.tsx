import { Phone, CalendarCheck, UserCheck, Zap, DollarSign, CreditCard } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import {
  overviewStats,
  callVolumeByHour,
  conversionFunnel,
  activityFeed,
  campaignSummary,
} from "@/lib/mock-data";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function Overview() {
  return (
    <div className="p-6 space-y-6 overflow-auto h-full" data-testid="page-overview">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Orlando Motors — Today's Performance</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          title="Total Calls Today"
          value={overviewStats.totalCallsToday.toString()}
          delta={`${overviewStats.callsDelta} vs yesterday`}
          deltaPositive={overviewStats.callsDeltaPositive}
          icon={Phone}
        />
        <StatCard
          title="Appointments Booked"
          value={overviewStats.appointmentsBooked.toString()}
          delta={`${overviewStats.appointmentsDelta} vs yesterday`}
          deltaPositive={overviewStats.appointmentsDeltaPositive}
          icon={CalendarCheck}
          subtitle={`${overviewStats.conversionRate}% conversion rate`}
        />
        <StatCard
          title="Show Rate"
          value={`${overviewStats.showRate}%`}
          delta={`${overviewStats.showRateDelta} vs last week`}
          deltaPositive={overviewStats.showRateDeltaPositive}
          icon={UserCheck}
        />
        <StatCard
          title="Avg Response Time"
          value={`${overviewStats.avgResponseTime}s`}
          delta={`${overviewStats.responseDelta} vs industry avg`}
          deltaPositive={overviewStats.responseDeltaPositive}
          icon={Zap}
          subtitle="Industry avg: 10+ seconds"
        />
        <StatCard
          title="Revenue Impact"
          value={`$${overviewStats.revenueImpact.toLocaleString()}`}
          delta={`${overviewStats.revenueDelta} vs yesterday`}
          deltaPositive={overviewStats.revenueDeltaPositive}
          icon={DollarSign}
          subtitle="Based on $266 avg gross/appt"
        />
        <StatCard
          title="AI Cost Today"
          value={`$${overviewStats.aiCost.toFixed(2)}`}
          delta={`$${overviewStats.costPerAppointment.toFixed(2)}/appt`}
          deltaPositive={true}
          icon={CreditCard}
          subtitle="~$0.011/min"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Call Volume by Hour */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-sm font-medium text-foreground">Call Volume by Hour</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-700 mr-1.5 align-middle" />
              Business hours
              <span className="inline-block w-2 h-2 rounded-full bg-gray-700/40 mr-1.5 ml-3 align-middle" />
              After hours (AI advantage)
            </p>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={callVolumeByHour} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: "#666" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#666" }}
                  tickLine={false}
                  axisLine={false}
                  width={24}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #2a2a2a",
                    borderRadius: "8px",
                    color: "#e5e5e5",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="calls" radius={[3, 3, 0, 0]} maxBarSize={24}>
                  {callVolumeByHour.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.afterHours ? "rgba(75, 85, 99, 0.35)" : "#4B5563"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="mb-4">
            <h2 className="text-sm font-medium text-foreground">Conversion Funnel</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Today's call-to-appointment pipeline</p>
          </div>
          <div className="space-y-3">
            {conversionFunnel.map((step, i) => (
              <div key={step.stage} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{step.stage}</span>
                  <span className="text-xs font-medium text-foreground">
                    {step.value}
                    <span className="text-muted-foreground ml-1">({step.percentage}%)</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${step.percentage}%`,
                      backgroundColor:
                        i === 0
                          ? "#4B5563"
                          : i === 1
                          ? "#c09a3d"
                          : i === 2
                          ? "#ab8c37"
                          : i === 3
                          ? "#10b981"
                          : "#059669",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Activity Feed */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-medium text-foreground mb-4">Recent Activity</h2>
          <div className="space-y-0">
            {activityFeed.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0"
                data-testid={`activity-item-${item.id}`}
              >
                <div
                  className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                    item.type === "appointment"
                      ? "bg-emerald-400"
                      : item.type === "scan"
                      ? "bg-gray-700"
                      : item.type === "transfer"
                      ? "bg-blue-400"
                      : "bg-muted-foreground"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground/90 leading-relaxed">{item.message}</p>
                </div>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{item.timestamp}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Campaign Performance */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-medium text-foreground mb-4">Campaign Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-[11px] font-medium text-muted-foreground pb-2.5 pr-4">Campaign</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground pb-2.5 px-2">Mailed</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground pb-2.5 px-2">Scans</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground pb-2.5 px-2">Appts</th>
                  <th className="text-right text-[11px] font-medium text-muted-foreground pb-2.5 pl-2">Conv %</th>
                </tr>
              </thead>
              <tbody>
                {campaignSummary.map((c) => (
                  <tr key={c.name} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 pr-4 text-xs text-foreground">{c.name}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground text-right">{c.piecesMailed.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground text-right">{c.qrScans}</td>
                    <td className="py-2.5 px-2 text-xs text-foreground text-right font-medium">{c.appointments}</td>
                    <td className="py-2.5 pl-2 text-xs text-emerald-600 text-right font-medium">{c.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
