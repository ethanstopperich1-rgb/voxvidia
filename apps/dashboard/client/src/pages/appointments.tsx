import { useState } from "react";
import { CalendarDays, List } from "lucide-react";
import { appointments, type Appointment } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";

const statusBadge: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-blue-400/10 text-blue-400 border-blue-400/20" },
  confirmed: { label: "Confirmed", className: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" },
  completed: { label: "Completed", className: "bg-[#555]/10 text-[#888] border-[#555]/20" },
  no_show: { label: "No Show", className: "bg-rose-400/10 text-rose-400 border-rose-400/20" },
};

const sourceBadge: Record<string, { label: string; className: string }> = {
  voice_ai: { label: "Voice AI", className: "bg-[#d4a843]/10 text-[#d4a843] border-[#d4a843]/20" },
  talking_postcard: { label: "Talking Postcard", className: "bg-purple-400/10 text-purple-400 border-purple-400/20" },
};

const crmBadge: Record<string, { label: string; className: string }> = {
  synced: { label: "Synced", className: "text-emerald-400" },
  pending: { label: "Pending", className: "text-[#d4a843]" },
  failed: { label: "Failed", className: "text-rose-400" },
};

function formatDateTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " at " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateShort(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimeShort(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// Get week days for calendar view
function getWeekDays(): Date[] {
  const today = new Date(2025, 0, 14); // Use fixed date matching mock data
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export default function Appointments() {
  const [view, setView] = useState<"list" | "calendar">("list");

  const sortedAppointments = [...appointments].sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
  );

  const weekDays = getWeekDays();

  const voiceAiCount = appointments.filter((a) => a.source === "voice_ai").length;
  const postcardCount = appointments.filter((a) => a.source === "talking_postcard").length;
  const confirmedCount = appointments.filter((a) => a.status === "confirmed" || a.status === "completed").length;
  const noShowCount = appointments.filter((a) => a.status === "no_show").length;

  return (
    <div className="p-6 space-y-6 overflow-auto h-full" data-testid="page-appointments">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Appointments</h1>
          <p className="text-sm text-muted-foreground mt-1">All appointments from Voice AI and Talking Postcard</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[#1e1e1e] bg-[#111] p-1">
          <button
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              view === "list" ? "bg-[#1a1a1a] text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="button-list-view"
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              view === "calendar" ? "bg-[#1a1a1a] text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="button-calendar-view"
          >
            <CalendarDays className="h-3.5 w-3.5" /> Calendar
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-3">
          <p className="text-[11px] text-muted-foreground">Total</p>
          <p className="text-lg font-semibold text-foreground">{appointments.length}</p>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-3">
          <p className="text-[11px] text-muted-foreground">Voice AI</p>
          <p className="text-lg font-semibold text-[#d4a843]">{voiceAiCount}</p>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-3">
          <p className="text-[11px] text-muted-foreground">Talking Postcard</p>
          <p className="text-lg font-semibold text-purple-400">{postcardCount}</p>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-3">
          <p className="text-[11px] text-muted-foreground">Show Rate</p>
          <p className="text-lg font-semibold text-emerald-400">
            {((confirmedCount + appointments.filter(a=>a.status==="completed").length - noShowCount) / appointments.length * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {view === "list" ? (
        /* List View */
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1a1a1a] bg-[#0d0d0d]">
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Date/Time</th>
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Customer</th>
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Vehicle</th>
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Source</th>
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Type</th>
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Status</th>
                  <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">CRM</th>
                </tr>
              </thead>
              <tbody>
                {sortedAppointments.map((apt) => (
                  <tr
                    key={apt.id}
                    className="border-b border-[#1a1a1a] last:border-0 hover:bg-[#161616] transition-colors"
                    data-testid={`appointment-row-${apt.id}`}
                  >
                    <td className="py-3 px-4 text-xs text-foreground whitespace-nowrap">{formatDateTime(apt.dateTime)}</td>
                    <td className="py-3 px-4">
                      <p className="text-xs text-foreground font-medium">{apt.customerName}</p>
                      <p className="text-[11px] text-muted-foreground">{apt.customerPhone}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{apt.vehicle || "--"}</td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className={`text-[11px] border ${sourceBadge[apt.source].className}`}>
                        {sourceBadge[apt.source].label}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground capitalize">{apt.type}</td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className={`text-[11px] border ${statusBadge[apt.status].className}`}>
                        {statusBadge[apt.status].label}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs ${crmBadge[apt.crmSync].className}`}>
                        {crmBadge[apt.crmSync].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Calendar View */
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-4">
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day) => {
              const dayStr = day.toISOString().split("T")[0];
              const dayAppts = sortedAppointments.filter((a) => a.dateTime.startsWith(dayStr));
              const isToday = dayStr === "2025-01-14";
              return (
                <div key={dayStr} className={`rounded-md p-2 min-h-[200px] ${isToday ? "bg-[#1a1a1a] ring-1 ring-[#d4a843]/30" : "bg-[#0d0d0d]"}`}>
                  <div className="text-center mb-2">
                    <p className="text-[10px] text-muted-foreground">{day.toLocaleDateString("en-US", { weekday: "short" })}</p>
                    <p className={`text-sm font-semibold ${isToday ? "text-[#d4a843]" : "text-foreground"}`}>
                      {day.getDate()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {dayAppts.map((apt) => (
                      <div
                        key={apt.id}
                        className={`rounded px-1.5 py-1 text-[10px] leading-tight ${
                          apt.source === "voice_ai" ? "bg-[#d4a843]/10 text-[#d4a843]" : "bg-purple-400/10 text-purple-400"
                        }`}
                      >
                        <span className="font-medium">{formatTimeShort(apt.dateTime)}</span>
                        <br />
                        {apt.customerName.split(" ")[0]} — {apt.type}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
