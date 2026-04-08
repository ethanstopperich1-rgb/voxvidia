import { useState } from "react";
import { Search, Phone, Video, X } from "lucide-react";
import { voiceCalls, type VoiceCall } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const outcomeBadge: Record<string, { label: string; className: string }> = {
  appointment_set: { label: "Appointment Set", className: "bg-emerald-50 text-emerald-600 border-emerald-400/20" },
  follow_up: { label: "Follow Up", className: "bg-gray-700/10 text-gray-700 border-gray-300" },
  declined: { label: "Declined", className: "bg-red-50 text-red-600 border-rose-400/20" },
  transferred: { label: "Transferred", className: "bg-blue-50 text-blue-600 border-blue-400/20" },
  no_answer: { label: "No Answer", className: "bg-gray-400/10 text-gray-500 border-gray-300" },
};

const sentimentBadge: Record<string, { label: string; className: string }> = {
  positive: { label: "Positive", className: "bg-emerald-50 text-emerald-600 border-emerald-400/20" },
  neutral: { label: "Neutral", className: "bg-gray-400/10 text-gray-500 border-gray-300" },
  negative: { label: "Negative", className: "bg-red-50 text-red-600 border-rose-400/20" },
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

export default function Transcripts() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTranscript, setSelectedTranscript] = useState<VoiceCall | null>(null);

  // Only show calls with actual transcripts
  const allTranscripts = voiceCalls.filter((c) => c.transcript.length > 0);

  const filteredTranscripts = allTranscripts.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.callerName.toLowerCase().includes(q) ||
      c.callerPhone.includes(q) ||
      c.vehicle.toLowerCase().includes(q) ||
      c.transcript.some((m) => m.text.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-6 space-y-6 overflow-auto h-full" data-testid="page-transcripts">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Transcripts</h1>
        <p className="text-sm text-muted-foreground mt-1">Searchable transcript library</p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by name, phone, vehicle, or transcript content..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-white border-gray-200 text-sm placeholder:text-muted-foreground/50"
          data-testid="input-search-transcripts"
        />
      </div>

      {/* Transcript Cards */}
      <div className="space-y-3">
        {filteredTranscripts.map((call) => (
          <div
            key={call.id}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors cursor-pointer"
            onClick={() => setSelectedTranscript(call)}
            data-testid={`transcript-card-${call.id}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100">
                  <Phone className="h-4 w-4 text-gray-700" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{call.callerName}</h3>
                    <span className="text-[11px] text-muted-foreground">{call.callerPhone}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-muted-foreground">{formatTime(call.timestamp)}</span>
                    <span className="text-[11px] text-muted-foreground/50">·</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{formatDuration(call.duration)}</span>
                    <span className="text-[11px] text-muted-foreground/50">·</span>
                    <span className="text-[11px] text-muted-foreground">{call.vehicle}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-[11px] border ${outcomeBadge[call.outcome].className}`}>
                  {outcomeBadge[call.outcome].label}
                </Badge>
                <Badge variant="outline" className={`text-[11px] border ${sentimentBadge[call.sentiment].className}`}>
                  {sentimentBadge[call.sentiment].label}
                </Badge>
              </div>
            </div>

            {/* Preview */}
            {call.transcript.length > 0 && (
              <p className="text-xs text-muted-foreground/70 mt-3 line-clamp-2 leading-relaxed">
                {call.transcript[0].text}
              </p>
            )}
          </div>
        ))}

        {filteredTranscripts.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No transcripts match your search</p>
          </div>
        )}
      </div>

      {/* Full Transcript View */}
      {selectedTranscript && (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="full-transcript-panel">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedTranscript(null)} />
          <div className="relative w-full max-w-lg bg-white border-l border-gray-200 overflow-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-5 flex items-center justify-between z-10">
              <div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-700" />
                  <h3 className="text-sm font-semibold text-foreground">{selectedTranscript.callerName}</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Voice Call · {formatTime(selectedTranscript.timestamp)} · {formatDuration(selectedTranscript.duration)}
                </p>
              </div>
              <button
                onClick={() => setSelectedTranscript(null)}
                className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-gray-100 transition-colors"
                data-testid="button-close-full-transcript"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Badges */}
            <div className="p-5 border-b border-gray-100 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-[11px] border ${outcomeBadge[selectedTranscript.outcome].className}`}>
                {outcomeBadge[selectedTranscript.outcome].label}
              </Badge>
              <Badge variant="outline" className={`text-[11px] border ${sentimentBadge[selectedTranscript.sentiment].className}`}>
                {sentimentBadge[selectedTranscript.sentiment].label}
              </Badge>
              <span className="text-[11px] text-muted-foreground ml-auto">{selectedTranscript.vehicle}</span>
            </div>

            {/* Messages */}
            <div className="p-5 space-y-4">
              {selectedTranscript.transcript.map((msg, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[11px] font-semibold ${
                      msg.speaker === "Maria" ? "text-gray-700" : "text-blue-600"
                    }`}>
                      {msg.speaker}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">{msg.timestamp}</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{msg.text}</p>
                  {msg.toolCall && (
                    <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-3">
                      <p className="text-[10px] text-gray-700 font-mono mb-1">
                        tool_call: {msg.toolCall.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono break-all">
                        {msg.toolCall.args}
                      </p>
                      <p className="text-[10px] text-emerald-600 font-mono mt-1">
                        {msg.toolCall.result}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
