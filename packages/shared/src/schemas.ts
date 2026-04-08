import { z } from 'zod';

// ── Call Record ──────────────────────────────────────────────────────────────

export const CallRecordSchema = z.object({
  id: z.string().uuid(),
  callSid: z.string(),
  fromNumber: z.string(),
  toNumber: z.string(),
  status: z.enum(['initiated', 'ringing', 'answered', 'completed', 'failed']),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  recordingUrl: z.string().nullable(),
  personaplexSessionId: z.string().nullable(), // Legacy column — retained for DB compat
  latencyFirstAiMs: z.number().nullable(),
  latencyFirstToolResultMs: z.number().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type CallRecord = z.infer<typeof CallRecordSchema>;

// ── Transcript Event ─────────────────────────────────────────────────────────

export const TranscriptEventSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  speaker: z.enum(['user', 'agent', 'system']),
  text: z.string(),
  startMs: z.number(),
  endMs: z.number().nullable(),
  isPartial: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});

export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;

// ── Tool Event ───────────────────────────────────────────────────────────────

export const ToolEventSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  toolName: z.string(),
  direction: z.enum(['request', 'response']),
  payloadJson: z.any(),
  status: z.enum(['pending', 'success', 'error', 'timeout']),
  latencyMs: z.number().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

export type ToolEvent = z.infer<typeof ToolEventSchema>;

// ── Post-call Report ─────────────────────────────────────────────────────────

export const PostcallReportSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  summary: z.string(),
  intent: z.string(),
  outcome: z.string(),
  followUpRequired: z.boolean(),
  followUpAt: z.string().datetime({ offset: true }).nullable(),
  crmNote: z.string(),
  qaFlagsJson: z.any(),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'frustrated']),
  createdAt: z.string().datetime({ offset: true }),
});

export type PostcallReport = z.infer<typeof PostcallReportSchema>;
