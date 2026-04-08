import { useState, useEffect } from "react";
import { Mail, ArrowRight, X } from "lucide-react";
import type { Campaign } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";

const statusBadge: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-50 text-emerald-600 border-emerald-400/20" },
  completed: { label: "Completed", className: "bg-gray-400/10 text-gray-500 border-gray-300" },
  draft: { label: "Draft", className: "bg-gray-700/10 text-gray-700 border-gray-300" },
};

function MiniChart({ data }: { data: number[] }) {
  if (data.length === 0) return <div className="h-10 flex items-center text-xs text-muted-foreground">No data</div>;
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-[2px] h-10">
      {data.map((v, i) => (
        <div
          key={i}
          className="bg-gray-700/40 rounded-t-sm min-w-[2px] flex-1"
          style={{ height: `${(v / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

export default function Campaigns() {
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setCampaigns(data))
      .catch(() => setCampaigns([]));
  }, []);

  return (
    <div className="p-6 space-y-6 overflow-auto h-full" data-testid="page-campaigns">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">Talking Postcard mail campaigns</p>
        </div>
      </div>

      {/* Campaign Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaigns.map((campaign) => (
          <div
            key={campaign.id}
            className="rounded-lg border border-gray-200 bg-white p-5 hover:border-gray-300 transition-colors cursor-pointer"
            onClick={() => setSelectedCampaign(campaign)}
            data-testid={`campaign-card-${campaign.id}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100">
                  <Mail className="h-4 w-4 text-gray-700" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground">{campaign.name}</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {campaign.startDate} {campaign.endDate ? ` — ${campaign.endDate}` : ""}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className={`text-[11px] border ${statusBadge[campaign.status].className}`}>
                {statusBadge[campaign.status].label}
              </Badge>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div>
                <p className="text-[11px] text-muted-foreground">Mailed</p>
                <p className="text-sm font-semibold text-foreground">{campaign.piecesMailed.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">QR Scans</p>
                <p className="text-sm font-semibold text-foreground">{campaign.qrScans}</p>
                {campaign.piecesMailed > 0 && (
                  <p className="text-[10px] text-muted-foreground/60">
                    {((campaign.qrScans / campaign.piecesMailed) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Convos</p>
                <p className="text-sm font-semibold text-foreground">{campaign.conversationsStarted}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Appts</p>
                <p className="text-sm font-semibold text-emerald-600">{campaign.appointmentsBooked}</p>
                {campaign.qrScans > 0 && (
                  <p className="text-[10px] text-emerald-600/60">
                    {((campaign.appointmentsBooked / campaign.qrScans) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </div>

            {/* Mini Chart */}
            <MiniChart data={campaign.scanData} />

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <span className="text-[11px] text-muted-foreground">Scans over time</span>
              <span className="text-[11px] text-gray-700 flex items-center gap-1">
                View details <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Campaign Detail Slide-out */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="campaign-detail-panel">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedCampaign(null)} />
          <div className="relative w-full max-w-lg bg-white border-l border-gray-200 overflow-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-5 flex items-center justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedCampaign.name}</h3>
                <Badge variant="outline" className={`mt-1 text-[11px] border ${statusBadge[selectedCampaign.status].className}`}>
                  {statusBadge[selectedCampaign.status].label}
                </Badge>
              </div>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-gray-100 transition-colors"
                data-testid="button-close-campaign"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Funnel */}
            <div className="p-5 border-b border-gray-100">
              <h4 className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">Conversion Funnel</h4>
              <div className="space-y-3">
                {[
                  { stage: "Pieces Mailed", value: selectedCampaign.piecesMailed, pct: 100 },
                  { stage: "QR Scanned", value: selectedCampaign.qrScans, pct: selectedCampaign.piecesMailed > 0 ? (selectedCampaign.qrScans / selectedCampaign.piecesMailed) * 100 : 0 },
                  { stage: "Conversation Started", value: selectedCampaign.conversationsStarted, pct: selectedCampaign.piecesMailed > 0 ? (selectedCampaign.conversationsStarted / selectedCampaign.piecesMailed) * 100 : 0 },
                  { stage: "Appointment Booked", value: selectedCampaign.appointmentsBooked, pct: selectedCampaign.piecesMailed > 0 ? (selectedCampaign.appointmentsBooked / selectedCampaign.piecesMailed) * 100 : 0 },
                  { stage: "Appointment Kept", value: selectedCampaign.appointmentsKept, pct: selectedCampaign.piecesMailed > 0 ? (selectedCampaign.appointmentsKept / selectedCampaign.piecesMailed) * 100 : 0 },
                ].map((step) => (
                  <div key={step.stage} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{step.stage}</span>
                      <span className="text-xs text-foreground font-medium">
                        {step.value.toLocaleString()}
                        <span className="text-muted-foreground ml-1">({step.pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gray-700"
                        style={{ width: `${Math.max(step.pct, 1)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Metrics */}
            <div className="p-5">
              <h4 className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">Key Metrics</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">Scan Rate</p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedCampaign.piecesMailed > 0
                      ? ((selectedCampaign.qrScans / selectedCampaign.piecesMailed) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Scan-to-Appt Rate</p>
                  <p className="text-lg font-semibold text-emerald-600">
                    {selectedCampaign.qrScans > 0
                      ? ((selectedCampaign.appointmentsBooked / selectedCampaign.qrScans) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Show Rate</p>
                  <p className="text-lg font-semibold text-foreground">
                    {selectedCampaign.appointmentsBooked > 0
                      ? ((selectedCampaign.appointmentsKept / selectedCampaign.appointmentsBooked) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Cost per Appointment</p>
                  <p className="text-lg font-semibold text-foreground">
                    ${selectedCampaign.appointmentsBooked > 0
                      ? ((selectedCampaign.piecesMailed * 0.85) / selectedCampaign.appointmentsBooked).toFixed(2)
                      : "--"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
