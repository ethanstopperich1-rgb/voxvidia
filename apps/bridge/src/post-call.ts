/**
 * Post-call analysis via GPT-4.1 mini.
 *
 * Runs after a call ends to extract structured data from the full transcript.
 * Writes results to the `call_analysis` Supabase table.
 */

import { createLogger } from '@voxvidia/shared';

const logger = createLogger('bridge:postcall');

export interface CallData {
  callSid: string;
  dealerId: string;
  transcript: Array<{ speaker: string; text: string; timestamp_ms: number }>;
  toolCalls: Array<{ name: string; args: any; result: any; success: boolean }>;
  durationSeconds: number;
}

export interface CallAnalysis {
  summary: string;
  lead_outcome: string;
  sentiment: string;
  customer_name: string | null;
  customer_vehicle: string | null;
  still_owns_vehicle: boolean | null;
  appointment_booked: boolean;
  appointment_date: string | null;
  appointment_time: string | null;
  follow_up_needed: boolean;
  follow_up_action: string | null;
  qa_flags: string[];
}

export async function runPostCallAnalysis(
  openaiKey: string,
  callData: CallData,
): Promise<CallAnalysis> {
  const transcriptText = callData.transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join('\n');

  const prompt = `Analyze this phone call transcript and extract structured data.

Transcript:
${transcriptText}

Tool calls made: ${callData.toolCalls.map((t) => t.name).join(', ') || 'none'}
Duration: ${callData.durationSeconds} seconds

Extract:
1. summary (2-3 sentences)
2. lead_outcome (one of: appointment_booked, interested_no_time, not_interested, no_longer_has_vehicle, wrong_person, transferred, callback_requested, dropped)
3. sentiment (positive, neutral, negative, frustrated)
4. customer_name (if mentioned)
5. customer_vehicle (if mentioned)
6. still_owns_vehicle (true/false/null)
7. appointment_booked (true/false)
8. appointment_date (if booked, ISO date string)
9. appointment_time (if booked, e.g. "10:00 AM")
10. follow_up_needed (true/false)
11. follow_up_action (if needed)
12. qa_flags (array of issues: long_silence, repeated_question, asked_for_human, pricing_requested)

Return ONLY valid JSON.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a call analysis assistant. Return only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const analysis: CallAnalysis = JSON.parse(data.choices[0].message.content);

  logger.info('Post-call analysis complete', {
    callSid: callData.callSid,
    outcome: analysis.lead_outcome,
    sentiment: analysis.sentiment,
    appointmentBooked: analysis.appointment_booked,
  });

  return analysis;
}
