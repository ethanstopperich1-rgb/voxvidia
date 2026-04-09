import { supabase } from './supabase.js';
import { createLogger } from '@voxvidia/shared';
import type { CallRecord } from '@voxvidia/shared';

const logger = createLogger('storage:calls');
const TABLE = 'calls';

export interface CreateCallInput {
  callSid: string;
  fromNumber: string;
  toNumber: string;
  status: CallRecord['status'];
  startedAt: string;
  personaplexSessionId?: string | null;
}

export interface UpdateCallInput {
  status?: CallRecord['status'];
  endedAt?: string | null;
  recordingUrl?: string | null;
  personaplexSessionId?: string | null;
  latencyFirstAiMs?: number | null;
  latencyFirstToolResultMs?: number | null;
}

export async function createCall(data: CreateCallInput): Promise<CallRecord | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping createCall');
    return null;
  }

  const row = {
    call_sid: data.callSid,
    from_number: data.fromNumber,
    to_number: data.toNumber,
    status: data.status,
    started_at: data.startedAt,
    personaplex_session_id: data.personaplexSessionId ?? null,
  };

  const { data: result, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error('Failed to create call', { error: error.message, callSid: data.callSid });
    throw error;
  }

  return mapRow(result);
}

export async function updateCall(callSid: string, updates: UpdateCallInput): Promise<CallRecord | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping updateCall');
    return null;
  }

  const row: Record<string, unknown> = {};
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.endedAt !== undefined) row.ended_at = updates.endedAt;
  if (updates.recordingUrl !== undefined) row.recording_url = updates.recordingUrl;
  if (updates.personaplexSessionId !== undefined) row.personaplex_session_id = updates.personaplexSessionId;
  if (updates.latencyFirstAiMs !== undefined) row.latency_first_ai_ms = updates.latencyFirstAiMs;
  if (updates.latencyFirstToolResultMs !== undefined) row.latency_first_tool_result_ms = updates.latencyFirstToolResultMs;
  row.updated_at = new Date().toISOString();

  const { data: result, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('call_sid', callSid)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update call', { error: error.message, callSid });
    throw error;
  }

  return mapRow(result);
}

export async function getCall(callSid: string): Promise<CallRecord | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping getCall');
    return null;
  }

  const { data: result, error } = await supabase
    .from(TABLE)
    .select()
    .eq('call_sid', callSid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    logger.error('Failed to get call', { error: error.message, callSid });
    throw error;
  }

  return mapRow(result);
}

export async function completeCall(
  callSid: string,
  endedAt: string,
  recordingUrl?: string | null,
): Promise<CallRecord | null> {
  return updateCall(callSid, {
    status: 'completed',
    endedAt,
    recordingUrl: recordingUrl ?? null,
  });
}

function mapRow(row: Record<string, unknown>): CallRecord {
  return {
    id: row.id as string,
    callSid: row.call_sid as string,
    fromNumber: row.from_number as string,
    toNumber: row.to_number as string,
    status: row.status as CallRecord['status'],
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string) ?? null,
    recordingUrl: (row.recording_url as string) ?? null,
    personaplexSessionId: (row.personaplex_session_id as string) ?? null,
    latencyFirstAiMs: (row.latency_first_ai_ms as number) ?? null,
    latencyFirstToolResultMs: (row.latency_first_tool_result_ms as number) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
