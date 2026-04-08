import type { Express } from "express";
import type { Server } from "http";
import { supabase, isConnected } from "./supabase";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Health check ──────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", supabase: isConnected() });
  });

  // ── Voice Calls ───────────────────────────────────────────────────────────
  app.get("/api/voice-calls", async (_req, res) => {
    if (!supabase) return res.json([]);

    const { data: calls, error } = await supabase
      .from("calls")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Failed to fetch calls:", error);
      return res.status(500).json({ error: error.message });
    }

    // Join with transcripts and analysis
    const enriched = await Promise.all(
      (calls || []).map(async (call: any) => {
        const [transcriptRes, analysisRes, toolsRes] = await Promise.all([
          supabase.from("call_transcripts").select("*").eq("call_sid", call.call_sid).order("timestamp_ms"),
          supabase.from("call_analysis").select("*").eq("call_sid", call.call_sid).single(),
          supabase.from("call_tool_calls").select("*").eq("call_sid", call.call_sid).order("called_at"),
        ]);

        const analysis = analysisRes.data;
        const transcript = (transcriptRes.data || []).map((t: any) => ({
          role: t.speaker,
          content: t.text,
          timestamp: new Date(t.created_at).toLocaleTimeString(),
        }));

        return {
          id: call.id,
          callSid: call.call_sid,
          callerName: analysis?.customer_name || "Unknown Caller",
          callerPhone: call.from_number,
          direction: call.direction || "inbound",
          duration: call.duration_seconds || 0,
          outcome: mapOutcome(analysis?.lead_outcome),
          sentiment: analysis?.sentiment || "neutral",
          cost: estimateCost(call.duration_seconds || 0),
          vehicle: analysis?.customer_vehicle || "",
          appointmentType: analysis?.appointment_type || "",
          transcript,
          timestamp: call.started_at,
          agentName: "Maria",
          // Analysis fields
          summary: analysis?.summary || "",
          appointmentBooked: analysis?.appointment_booked || false,
          appointmentDate: analysis?.appointment_date,
          appointmentTime: analysis?.appointment_time,
          confirmationCode: analysis?.confirmation_code,
          followUpNeeded: analysis?.follow_up_needed || false,
          qaFlags: analysis?.qa_flags || [],
          toolCalls: (toolsRes.data || []).map((t: any) => ({
            name: t.tool_name,
            args: t.arguments,
            result: t.result,
            latency: t.latency_ms,
            success: t.success,
          })),
        };
      })
    );

    res.json(enriched);
  });

  // ── Single Call Detail ────────────────────────────────────────────────────
  app.get("/api/voice-calls/:callSid", async (req, res) => {
    if (!supabase) return res.status(404).json({ error: "Not connected" });

    const { callSid } = req.params;

    const [callRes, transcriptRes, analysisRes, toolsRes] = await Promise.all([
      supabase.from("calls").select("*").eq("call_sid", callSid).single(),
      supabase.from("call_transcripts").select("*").eq("call_sid", callSid).order("timestamp_ms"),
      supabase.from("call_analysis").select("*").eq("call_sid", callSid).single(),
      supabase.from("call_tool_calls").select("*").eq("call_sid", callSid).order("called_at"),
    ]);

    if (callRes.error) return res.status(404).json({ error: "Call not found" });

    res.json({
      call: callRes.data,
      transcript: transcriptRes.data || [],
      analysis: analysisRes.data,
      toolCalls: toolsRes.data || [],
    });
  });

  // ── Overview Stats ────────────────────────────────────────────────────────
  app.get("/api/overview-stats", async (_req, res) => {
    if (!supabase) return res.json(getDefaultStats());

    const today = new Date().toISOString().split("T")[0];

    const [callsRes, analysisRes] = await Promise.all([
      supabase.from("calls").select("*").gte("started_at", today + "T00:00:00Z"),
      supabase.from("call_analysis").select("*").gte("created_at", today + "T00:00:00Z"),
    ]);

    const calls = callsRes.data || [];
    const analyses = analysisRes.data || [];

    const totalCalls = calls.length;
    const appointmentsBooked = analyses.filter((a: any) => a.appointment_booked).length;
    const conversionRate = totalCalls > 0 ? Math.round((appointmentsBooked / totalCalls) * 100) : 0;
    const avgDuration = totalCalls > 0
      ? Math.round(calls.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0) / totalCalls)
      : 0;
    const avgLatency = analyses.length > 0
      ? Math.round(analyses.reduce((sum: number, a: any) => sum + (a.agent_response_latency_avg_ms || 0), 0) / analyses.length)
      : 0;
    const totalMinutes = calls.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0) / 60;
    const aiCost = totalMinutes * 0.025; // ~$0.025/min

    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
    analyses.forEach((a: any) => {
      if (a.sentiment && sentimentCounts.hasOwnProperty(a.sentiment)) {
        sentimentCounts[a.sentiment as keyof typeof sentimentCounts]++;
      }
    });

    res.json({
      totalCallsToday: totalCalls,
      appointmentsBooked,
      conversionRate,
      avgResponseTime: avgLatency,
      avgCallDuration: avgDuration,
      aiCost: aiCost.toFixed(2),
      revenueImpact: appointmentsBooked * 450, // $450 avg RO
      afterHoursCalls: calls.filter((c: any) => {
        const hour = new Date(c.started_at).getHours();
        return hour < 9 || hour >= 20;
      }).length,
      sentiment: sentimentCounts,
      showRate: 70, // placeholder until we track show rates
    });
  });

  // ── Call Volume by Hour ───────────────────────────────────────────────────
  app.get("/api/call-volume-hourly", async (_req, res) => {
    if (!supabase) return res.json([]);

    const today = new Date().toISOString().split("T")[0];
    const { data: calls } = await supabase
      .from("calls")
      .select("started_at")
      .gte("started_at", today + "T00:00:00Z");

    const hourly = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i}:00`,
      calls: 0,
      afterHours: i < 9 || i >= 20,
    }));

    (calls || []).forEach((c: any) => {
      const hour = new Date(c.started_at).getHours();
      hourly[hour].calls++;
    });

    res.json(hourly);
  });

  // ── Activity Feed ─────────────────────────────────────────────────────────
  app.get("/api/activity-feed", async (_req, res) => {
    if (!supabase) return res.json([]);

    const [callsRes, analysisRes] = await Promise.all([
      supabase.from("calls").select("call_sid, from_number, started_at, status").order("started_at", { ascending: false }).limit(10),
      supabase.from("call_analysis").select("call_sid, customer_name, lead_outcome, summary").order("created_at", { ascending: false }).limit(10),
    ]);

    const feed = (analysisRes.data || []).map((a: any, i: number) => ({
      id: i + 1,
      message: buildActivityMessage(a),
      timestamp: callsRes.data?.find((c: any) => c.call_sid === a.call_sid)?.started_at || new Date().toISOString(),
      type: a.lead_outcome === "appointment_booked" ? "success" : a.lead_outcome === "transferred" ? "transfer" : "call",
    }));

    res.json(feed);
  });

  // ── Appointments ──────────────────────────────────────────────────────────
  app.get("/api/appointments", async (_req, res) => {
    if (!supabase) return res.json([]);

    const { data: analyses } = await supabase
      .from("call_analysis")
      .select("*")
      .eq("appointment_booked", true)
      .order("appointment_date", { ascending: true });

    const appointments = (analyses || []).map((a: any, i: number) => ({
      id: i + 1,
      customerName: a.customer_name || "Unknown",
      customerPhone: a.customer_phone || "",
      vehicle: a.customer_vehicle || "",
      source: "voice_ai",
      type: a.appointment_type || "appraisal",
      status: "scheduled",
      dateTime: a.appointment_date ? `${a.appointment_date}T${a.appointment_time || "10:00:00"}` : new Date().toISOString(),
      crmSync: "pending",
      confirmationCode: a.confirmation_code,
    }));

    res.json(appointments);
  });

  // ── Campaigns (stub for now) ──────────────────────────────────────────────
  app.get("/api/campaigns", async (_req, res) => {
    // Campaigns table doesn't exist in Supabase yet — return placeholder
    res.json([
      {
        id: 1,
        name: "Spring Buyback 2026",
        status: "active",
        piecesMailed: 2500,
        qrScans: 187,
        conversationsStarted: 43,
        appointmentsBooked: 12,
        appointmentsKept: 8,
        startDate: "2026-03-15",
        endDate: null,
        scanData: Array.from({ length: 30 }, () => Math.floor(Math.random() * 15)),
      },
    ]);
  });

  return httpServer;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapOutcome(leadOutcome: string | null): string {
  const map: Record<string, string> = {
    appointment_booked: "appointment_set",
    interested_no_time: "follow_up",
    not_interested: "declined",
    transferred: "transferred",
    no_longer_has_vehicle: "declined",
    wrong_person: "declined",
    callback_requested: "follow_up",
    dropped: "no_answer",
  };
  return map[leadOutcome || ""] || "follow_up";
}

function estimateCost(durationSeconds: number): number {
  return Math.round((durationSeconds / 60) * 0.025 * 100) / 100; // $0.025/min
}

function buildActivityMessage(analysis: any): string {
  const name = analysis.customer_name || "A caller";
  switch (analysis.lead_outcome) {
    case "appointment_booked":
      return `${name} booked a VIP appraisal appointment`;
    case "interested_no_time":
      return `${name} showed interest but didn't schedule`;
    case "not_interested":
      return `${name} declined the buyback offer`;
    case "transferred":
      return `${name} was transferred to the VIP desk`;
    case "callback_requested":
      return `${name} requested a callback`;
    default:
      return `Call with ${name} completed`;
  }
}

function getDefaultStats() {
  return {
    totalCallsToday: 0,
    appointmentsBooked: 0,
    conversionRate: 0,
    avgResponseTime: 0,
    avgCallDuration: 0,
    aiCost: "0.00",
    revenueImpact: 0,
    afterHoursCalls: 0,
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    showRate: 0,
  };
}
