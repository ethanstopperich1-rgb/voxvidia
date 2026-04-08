import { useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, TrendingUp, DollarSign, X, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { voiceCalls, type VoiceCall } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";

const outcomeBadge: Record<string, { label: string; className: string }> = {
  appointment_set: { label: "Appointment Set", className: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" },
  follow_up: { label: "Follow Up", className: "bg-[#d4a843]/10 text-[#d4a843] border-[#d4a843]/20" },
  declined: { label: "Declined", className: "bg-rose-400/10 text-rose-400 border-rose-400/20" },
  transferred: { label: "Transferred", className: "bg-blue-400/10 text-blue-400 border-blue-400/20" },
  no_answer: { label: "No Answer", className: "bg-[#555]/10 text-[#888] border-[#555]/20" },
};

const sentimentColor: Record<string, string> = {
  positive: "text-emerald-400",
  neutral: "text-muted-foreground",
  negative: "text-rose-400",
};

function formatDuration(seconds: number): string {
  if (seconds === 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function VoiceCalls() {
  const [selectedCall, setSelectedCall] = useState<VoiceCall | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filteredCalls = voiceCalls
    .filter((c) => {
      if (filter === "all") return true;
      if (filter === "inbound") return c.direction === "inbound";
      if (filter === "outbound") return c.direction === "outbound";
      return c.outcome === filter;
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const totalCalls = voiceCalls.length;
  const completedCalls = voiceCalls.filter((c) => c.duration > 0).length;
  const avgDuration = Math.round(
    voiceCalls.filter((c) => c.duration > 0).reduce((acc, c) => acc + c.duration, 0) / completedCalls
  );
  const conversionRate = Math.round(
    (voiceCalls.filter((c) => c.outcome === "appointment_set").length / totalCalls) * 100
  );
  const totalCost = voiceCalls.reduce((acc, c) => acc + c.cost, 0);
  const costPerConversion =
    totalCost / voiceCalls.filter((c) => c.outcome === "appointment_set").length;

  return (
    <div className="p-6 space-y-6 overflow-auto h-full" data-testid="page-voice-calls">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Voice Calls</h1>
        <p className="text-sm text-muted-foreground mt-1">BDC command center — all AI voice interactions</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Calls", value: totalCalls.toString(), icon: Phone, delta: "+18% vs yesterday" },
          { label: "Completed", value: completedCalls.toString(), icon: PhoneIncoming, delta: `${Math.round((completedCalls/totalCalls)*100)}% answer rate` },
          { label: "Avg Duration", value: formatDuration(avgDuration), icon: Clock, delta: "Optimal range" },
          { label: "Conversion Rate", value: `${conversionRate}%`, icon: TrendingUp, delta: "+12% vs last week" },
          { label: "Cost / Conversion", value: `$${costPerConversion.toFixed(2)}`, icon: DollarSign, delta: "vs $8.50 human BDC" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-[#1e1e1e] bg-[#111] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <stat.icon className="h-3.5 w-3.5 text-[#d4a843]" />
              <span className="text-[11px] text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{stat.value}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{stat.delta}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {["all", "inbound", "outbound", "appointment_set", "follow_up", "transferred", "declined"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-[#d4a843]/15 text-[#d4a843] border border-[#d4a843]/30"
                : "bg-[#161616] text-muted-foreground border border-[#1e1e1e] hover:border-[#2a2a2a] hover:text-foreground"
            }`}
            data-testid={`filter-${f}`}
          >
            {f === "all" ? "All" : f === "appointment_set" ? "Appt Set" : f === "follow_up" ? "Follow Up" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Call Table */}
      <div className="rounded-lg border border-[#1e1e1e] bg-[#111] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a1a1a] bg-[#0d0d0d]">
                <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Time</th>
                <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Caller</th>
                <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Direction</th>
                <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Duration</th>
                <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Outcome</th>
                <th className="text-left text-[11px] font-medium text-muted-foreground py-3 px-4">Sentiment</th>
                <th className="text-right text-[11px] font-medium text-muted-foreground py-3 px-4">Cost</th>
              </tr>
            </thead>
            <tbody>
              {filteredCalls.map((call) => (
                <tr
                  key={call.id}
                  onClick={() => setSelectedCall(call)}
                  className="border-b border-[#1a1a1a] last:border-0 cursor-pointer hover:bg-[#161616] transition-colors"
                  data-testid={`call-row-${call.id}`}
                >
                  <td className="py-3 px-4 text-xs text-foreground">{formatTime(call.timestamp)}</td>
                  <td className="py-3 px-4">
                    <p className="text-xs text-foreground font-medium">{call.callerName}</p>
                    <p className="text-[11px] text-muted-foreground">{call.callerPhone}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {call.direction === "inbound" ? (
                        <ArrowDownRight className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3 text-blue-400" />
                      )}
                      {call.direction}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-muted-foreground font-mono">{formatDuration(call.duration)}</td>
                  <td className="py-3 px-4">
                    <Badge variant="outline" className={`text-[11px] border ${outcomeBadge[call.outcome].className}`}>
                      {outcomeBadge[call.outcome].label}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-xs capitalize ${sentimentColor[call.sentiment]}`}>
                      {call.sentiment}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-muted-foreground text-right font-mono">
                    ${call.cost.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-out Transcript Panel */}
      {selectedCall && (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="transcript-panel">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedCall(null)} />
          <div className="relative w-full max-w-lg bg-[#111] border-l border-[#1e1e1e] overflow-auto">
            <div className="sticky top-0 bg-[#111] border-b border-[#1e1e1e] p-5 flex items-center justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedCall.callerName}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatTime(selectedCall.timestamp)} · {formatDuration(selectedCall.duration)} · {selectedCall.direction}
                </p>
              </div>
              <button
                onClick={() => setSelectedCall(null)}
                className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
                data-testid="button-close-transcript"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Call metadata */}
            <div className="p-5 border-b border-[#1a1a1a]">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Vehicle", value: selectedCall.vehicle || "--" },
                  { label: "Type", value: selectedCall.appointmentType || "--" },
                  { label: "Outcome", value: outcomeBadge[selectedCall.outcome].label },
                  { label: "Sentiment", value: selectedCall.sentiment },
                  { label: "Cost", value: `$${selectedCall.cost.toFixed(3)}` },
                  { label: "Agent", value: selectedCall.agentName },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] text-muted-foreground">{item.label}</p>
                    <p className="text-xs text-foreground mt-0.5">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Transcript */}
            <div className="p-5">
              <h4 className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">Transcript</h4>
              <div className="space-y-4">
                {selectedCall.transcript.map((msg, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[11px] font-semibold ${
                        msg.speaker === "Maria" ? "text-[#d4a843]" : "text-blue-400"
                      }`}>
                        {msg.speaker}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">{msg.timestamp}</span>
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed">{msg.text}</p>
                    {msg.toolCall && (
                      <div className="mt-2 rounded-md bg-[#0a0a0a] border border-[#1e1e1e] p-3">
                        <p className="text-[10px] text-[#d4a843] font-mono mb-1">
                          tool_call: {msg.toolCall.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono break-all">
                          {msg.toolCall.args}
                        </p>
                        <p className="text-[10px] text-emerald-400 font-mono mt-1">
                          {msg.toolCall.result}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
