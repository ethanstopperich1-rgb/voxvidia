// ── Post-Call Summarizer ─────────────────────────────────────────────────────
// Builds a structured post-call report from transcript text and tool events
// using heuristic keyword extraction (no LLM dependency).

import type { TranscriptEvent, ToolEvent, PostcallReport } from '@voxvidia/shared';

export interface CallMeta {
  callSid: string;
  callId: string;
  fromNumber: string;
  toNumber: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number;
}

export interface PostcallReportData {
  summary: string;
  intent: string;
  outcome: string;
  followUpRequired: boolean;
  followUpAt: string | null;
  crmNote: string;
  sentiment: PostcallReport['sentiment'];
  qaFlags: string[];
}

// ── Intent Detection Keywords ───────────────────────────────────────────────

const INTENT_KEYWORDS: Record<string, string[]> = {
  'schedule appointment': ['book', 'schedule', 'appointment', 'meeting', 'calendar'],
  'reschedule': ['reschedule', 'move', 'change time', 'push back'],
  'cancel': ['cancel', 'remove', 'delete', 'get rid of'],
  'general inquiry': ['question', 'wondering', 'curious', 'information', 'tell me about'],
  'pricing inquiry': ['price', 'cost', 'how much', 'rate', 'fee', 'pricing'],
  'support request': ['help', 'issue', 'problem', 'not working', 'broken', 'error'],
  'follow-up': ['follow up', 'followup', 'check in', 'following up', 'get back'],
  'complaint': ['unhappy', 'frustrated', 'terrible', 'unacceptable', 'angry', 'complaint'],
};

const OUTCOME_SIGNALS: Record<string, string[]> = {
  'appointment booked': ['confirmed', 'booked', 'scheduled', 'appointment confirmed'],
  'appointment rescheduled': ['rescheduled', 'moved', 'new time'],
  'appointment cancelled': ['cancelled', 'removed'],
  'information provided': ['information', 'details', 'explained', 'clarified'],
  'transferred to human': ['transfer', 'someone will call', 'callback', 'have someone'],
  'issue resolved': ['resolved', 'fixed', 'taken care of', 'all set'],
  'no resolution': ['couldn\'t', 'unable', 'not able', 'sorry'],
};

const FOLLOWUP_SIGNALS = [
  'follow up', 'followup', 'check back', 'call back', 'call you back',
  'get back to', 'follow-up', 'next week', 'tomorrow', 'in a few days',
  'remind', 'reminder',
];

const POSITIVE_WORDS = [
  'thank', 'thanks', 'great', 'awesome', 'perfect', 'wonderful', 'appreciate',
  'excellent', 'happy', 'good', 'love', 'fantastic',
];

const NEGATIVE_WORDS = [
  'frustrated', 'angry', 'upset', 'unhappy', 'terrible', 'awful',
  'disappointed', 'annoyed', 'furious', 'horrible', 'unacceptable',
];

const QA_FLAGS_MAP: Record<string, RegExp> = {
  'long_silence': /(?:hello|are you there|still there)/i,
  'repeated_question': /(?:i already said|i told you|like i said)/i,
  'transfer_requested': /(?:talk to a (?:real |human |actual )?person|speak (?:to|with) (?:someone|a manager))/i,
  'profanity_detected': /(?:damn|hell|shit|fuck|ass)/i,
  'agent_apology': /(?:i apologize|sorry about that|my mistake)/i,
};

// ── Summarizer ──────────────────────────────────────────────────────────────

export function buildTranscriptText(events: TranscriptEvent[]): string {
  return events
    .filter((e) => !e.isPartial)
    .map((e) => `${e.speaker === 'user' ? 'Caller' : 'Agent'}: ${e.text}`)
    .join('\n');
}

export function summarizeCall(
  transcriptEvents: TranscriptEvent[],
  toolEvents: ToolEvent[],
  callMeta: CallMeta,
): PostcallReportData {
  const transcript = buildTranscriptText(transcriptEvents);
  const lower = transcript.toLowerCase();

  // ── Intent ──
  const intent = detectIntent(lower);

  // ── Outcome ──
  const outcome = detectOutcome(lower, toolEvents);

  // ── Follow-up ──
  const followUpRequired = FOLLOWUP_SIGNALS.some((s) => lower.includes(s));
  const followUpAt = followUpRequired ? extractFollowUpDate(lower, callMeta.startedAt) : null;

  // ── Sentiment ──
  const sentiment = detectSentiment(lower);

  // ── QA Flags ──
  const qaFlags = detectQaFlags(transcript);

  // ── Summary (2-3 sentences) ──
  const summary = buildSummary(intent, outcome, followUpRequired, callMeta, toolEvents);

  // ── CRM Note ──
  const crmNote = buildCrmNote(intent, outcome, followUpRequired, callMeta, toolEvents);

  return {
    summary,
    intent,
    outcome,
    followUpRequired,
    followUpAt,
    crmNote,
    sentiment,
    qaFlags,
  };
}

// ── Detection Helpers ───────────────────────────────────────────────────────

function detectIntent(lowerTranscript: string): string {
  let bestIntent = 'general inquiry';
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    const score = keywords.filter((k) => lowerTranscript.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return bestIntent;
}

function detectOutcome(lowerTranscript: string, toolEvents: ToolEvent[]): string {
  // Check tool events for concrete outcomes
  const successTools = toolEvents.filter((e) => e.direction === 'response' && e.status === 'success');

  for (const tool of successTools) {
    if (tool.toolName.includes('create_calendar') || tool.toolName.includes('book')) {
      return 'appointment booked';
    }
    if (tool.toolName.includes('reschedule')) {
      return 'appointment rescheduled';
    }
    if (tool.toolName.includes('cancel') || tool.toolName.includes('delete')) {
      return 'appointment cancelled';
    }
    if (tool.toolName.includes('note') || tool.toolName.includes('task')) {
      return 'note/task created';
    }
  }

  // Fallback to transcript signals
  let bestOutcome = 'information provided';
  let bestScore = 0;

  for (const [outcome, signals] of Object.entries(OUTCOME_SIGNALS)) {
    const score = signals.filter((s) => lowerTranscript.includes(s)).length;
    if (score > bestScore) {
      bestScore = score;
      bestOutcome = outcome;
    }
  }

  return bestOutcome;
}

function detectSentiment(lowerTranscript: string): PostcallReport['sentiment'] {
  const positiveCount = POSITIVE_WORDS.filter((w) => lowerTranscript.includes(w)).length;
  const negativeCount = NEGATIVE_WORDS.filter((w) => lowerTranscript.includes(w)).length;

  if (negativeCount >= 3) return 'frustrated';
  if (negativeCount > positiveCount) return 'negative';
  if (positiveCount > negativeCount + 1) return 'positive';
  return 'neutral';
}

function detectQaFlags(transcript: string): string[] {
  const flags: string[] = [];
  for (const [flag, pattern] of Object.entries(QA_FLAGS_MAP)) {
    if (pattern.test(transcript)) {
      flags.push(flag);
    }
  }
  return flags;
}

function extractFollowUpDate(lowerTranscript: string, startedAt: string): string | null {
  const base = new Date(startedAt);
  if (isNaN(base.getTime())) return null;

  if (lowerTranscript.includes('tomorrow')) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  if (lowerTranscript.includes('next week')) {
    const d = new Date(base);
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  const daysMatch = lowerTranscript.match(/in\s+(\d+)\s+days?/);
  if (daysMatch) {
    const d = new Date(base);
    d.setDate(d.getDate() + parseInt(daysMatch[1], 10));
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  // Default: follow up in 1 business day
  const d = new Date(base);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

// ── Summary Builders ────────────────────────────────────────────────────────

function buildSummary(
  intent: string,
  outcome: string,
  followUpRequired: boolean,
  callMeta: CallMeta,
  toolEvents: ToolEvent[],
): string {
  const toolCount = toolEvents.filter((e) => e.direction === 'response').length;
  const durationLabel = callMeta.durationSeconds
    ? `${Math.round(callMeta.durationSeconds / 60)} minute`
    : 'unknown duration';

  const parts: string[] = [];
  parts.push(`${durationLabel} call from ${callMeta.fromNumber}. Caller intent: ${intent}.`);
  parts.push(`Outcome: ${outcome}.`);

  if (toolCount > 0) {
    parts.push(`${toolCount} tool action${toolCount > 1 ? 's' : ''} executed.`);
  }
  if (followUpRequired) {
    parts.push('Follow-up required.');
  }

  return parts.join(' ');
}

function buildCrmNote(
  intent: string,
  outcome: string,
  followUpRequired: boolean,
  callMeta: CallMeta,
  toolEvents: ToolEvent[],
): string {
  const date = new Date(callMeta.startedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const lines: string[] = [];
  lines.push(`AI Call ${date} | ${callMeta.fromNumber}`);
  lines.push(`Intent: ${intent}`);
  lines.push(`Outcome: ${outcome}`);

  const successTools = toolEvents
    .filter((e) => e.direction === 'response' && e.status === 'success')
    .map((e) => e.toolName.replace(/_/g, ' '));

  if (successTools.length > 0) {
    lines.push(`Actions: ${successTools.join(', ')}`);
  }

  if (followUpRequired) {
    lines.push('** Follow-up required **');
  }

  return lines.join('\n');
}
