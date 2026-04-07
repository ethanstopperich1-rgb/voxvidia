import { supabase } from './supabase.js';
import { createLogger } from '@voxvidia/shared';
import type { TranscriptEvent } from '@voxvidia/shared';

const logger = createLogger('storage:transcripts');
const TABLE = 'pp_transcript_events';

export interface AddTranscriptEventInput {
  callId: string;
  speaker: TranscriptEvent['speaker'];
  text: string;
  startMs: number;
  endMs?: number | null;
  isPartial: boolean;
}

export async function addTranscriptEvent(data: AddTranscriptEventInput): Promise<TranscriptEvent | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping addTranscriptEvent');
    return null;
  }

  const row = {
    call_id: data.callId,
    speaker: data.speaker,
    text: data.text,
    start_ms: data.startMs,
    end_ms: data.endMs ?? null,
    is_partial: data.isPartial,
  };

  const { data: result, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error('Failed to add transcript event', { error: error.message, callId: data.callId });
    throw error;
  }

  return mapRow(result);
}

export async function getTranscriptForCall(callId: string): Promise<TranscriptEvent[]> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping getTranscriptForCall');
    return [];
  }

  const { data: results, error } = await supabase
    .from(TABLE)
    .select()
    .eq('call_id', callId)
    .order('start_ms', { ascending: true });

  if (error) {
    logger.error('Failed to get transcript', { error: error.message, callId });
    throw error;
  }

  return (results ?? []).map(mapRow);
}

function mapRow(row: Record<string, unknown>): TranscriptEvent {
  return {
    id: row.id as string,
    callId: row.call_id as string,
    speaker: row.speaker as TranscriptEvent['speaker'],
    text: row.text as string,
    startMs: row.start_ms as number,
    endMs: (row.end_ms as number) ?? null,
    isPartial: row.is_partial as boolean,
    createdAt: row.created_at as string,
  };
}
