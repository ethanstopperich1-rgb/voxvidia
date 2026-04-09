import { createClient } from '@supabase/supabase-js';

// Client-side Supabase — uses anon key or service key via env
// Vite exposes env vars prefixed with VITE_
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY || '';

export const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

export async function fetchCalls() {
  if (!supabase) return [];

  const { data: calls } = await supabase
    .from('calls')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(100);

  if (!calls || calls.length === 0) return [];

  // Enrich each call with analysis and transcripts
  const enriched = await Promise.all(
    calls.map(async (call: any) => {
      const [transcriptRes, analysisRes] = await Promise.all([
        supabase!.from('call_transcripts').select('*').eq('call_sid', call.call_sid).order('timestamp_ms'),
        supabase!.from('call_analysis').select('*').eq('call_sid', call.call_sid).maybeSingle(),
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
        callerName: analysis?.customer_name || 'Unknown Caller',
        callerPhone: call.from_number,
        direction: call.direction || 'inbound',
        duration: call.duration_seconds || 0,
        outcome: mapOutcome(analysis?.lead_outcome),
        sentiment: analysis?.sentiment || 'neutral',
        cost: Math.round(((call.duration_seconds || 0) / 60) * 0.025 * 100) / 100,
        vehicle: analysis?.customer_vehicle || '',
        appointmentType: analysis?.appointment_type || '',
        transcript,
        timestamp: call.started_at,
        agentName: 'Maria',
        summary: analysis?.summary || '',
        appointmentBooked: analysis?.appointment_booked || false,
        appointmentDate: analysis?.appointment_date,
        confirmationCode: analysis?.confirmation_code,
      };
    })
  );

  return enriched;
}

export async function fetchOverviewStats() {
  if (!supabase) return null;

  const today = new Date().toISOString().split('T')[0];

  const [callsRes, analysisRes] = await Promise.all([
    supabase.from('calls').select('*'),
    supabase.from('call_analysis').select('*'),
  ]);

  const calls = callsRes.data || [];
  const analyses = analysisRes.data || [];
  const totalCalls = calls.length;
  const appointmentsBooked = analyses.filter((a: any) => a.appointment_booked).length;

  return {
    totalCallsToday: totalCalls,
    appointmentsBooked,
    conversionRate: totalCalls > 0 ? Math.round((appointmentsBooked / totalCalls) * 100) : 0,
    avgResponseTime: analyses.length > 0
      ? Math.round(analyses.reduce((s: number, a: any) => s + (a.agent_response_latency_avg_ms || 0), 0) / analyses.length)
      : 0,
    avgCallDuration: totalCalls > 0
      ? Math.round(calls.reduce((s: number, c: any) => s + (c.duration_seconds || 0), 0) / totalCalls)
      : 0,
    aiCost: (calls.reduce((s: number, c: any) => s + (c.duration_seconds || 0), 0) / 60 * 0.025).toFixed(2),
    revenueImpact: appointmentsBooked * 450,
    showRate: 70,
  };
}

export async function fetchAppointments() {
  if (!supabase) return [];

  const { data } = await supabase
    .from('call_analysis')
    .select('*')
    .eq('appointment_booked', true)
    .order('appointment_date');

  return (data || []).map((a: any, i: number) => ({
    id: i + 1,
    customerName: a.customer_name || 'Unknown',
    customerPhone: a.customer_phone || '',
    vehicle: a.customer_vehicle || '',
    source: 'voice_ai',
    type: a.appointment_type || 'appraisal',
    status: 'scheduled',
    dateTime: a.appointment_date ? `${a.appointment_date}T${a.appointment_time || '10:00:00'}` : new Date().toISOString(),
    crmSync: 'pending',
    confirmationCode: a.confirmation_code,
  }));
}

export async function fetchActivityFeed() {
  if (!supabase) return [];

  const { data } = await supabase
    .from('call_analysis')
    .select('*, calls!inner(started_at, from_number)')
    .order('created_at', { ascending: false })
    .limit(10);

  return (data || []).map((a: any, i: number) => {
    const name = a.customer_name || 'A caller';
    let message = `Call with ${name} completed`;
    if (a.lead_outcome === 'appointment_booked') message = `${name} booked a VIP appraisal`;
    else if (a.lead_outcome === 'not_interested') message = `${name} declined the offer`;
    else if (a.lead_outcome === 'transferred') message = `${name} transferred to VIP desk`;

    return {
      id: i + 1,
      message,
      timestamp: a.created_at,
      type: a.lead_outcome === 'appointment_booked' ? 'success' : 'call',
    };
  });
}

function mapOutcome(leadOutcome: string | null): string {
  const map: Record<string, string> = {
    appointment_booked: 'appointment_set',
    interested_no_time: 'follow_up',
    not_interested: 'declined',
    transferred: 'transferred',
    no_longer_has_vehicle: 'declined',
    wrong_person: 'declined',
    callback_requested: 'follow_up',
    dropped: 'no_answer',
  };
  return map[leadOutcome || ''] || 'follow_up';
}
