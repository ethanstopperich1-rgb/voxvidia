import { supabase } from './supabase.js';
import { createLogger } from '@voxvidia/shared';
import type { PostcallReport } from '@voxvidia/shared';

const logger = createLogger('storage:postcall');
const TABLE = 'call_analysis';

export interface CreateReportInput {
  callId: string;
  summary: string;
  intent: string;
  outcome: string;
  followUpRequired: boolean;
  followUpAt?: string | null;
  crmNote: string;
  qaFlagsJson: unknown;
  sentiment: PostcallReport['sentiment'];
}

export async function createReport(data: CreateReportInput): Promise<PostcallReport | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping createReport');
    return null;
  }

  const row = {
    call_id: data.callId,
    summary: data.summary,
    intent: data.intent,
    outcome: data.outcome,
    follow_up_required: data.followUpRequired,
    follow_up_at: data.followUpAt ?? null,
    crm_note: data.crmNote,
    qa_flags_json: data.qaFlagsJson,
    sentiment: data.sentiment,
  };

  const { data: result, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error('Failed to create postcall report', { error: error.message, callId: data.callId });
    throw error;
  }

  return mapRow(result);
}

export async function getReportForCall(callId: string): Promise<PostcallReport | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping getReportForCall');
    return null;
  }

  const { data: result, error } = await supabase
    .from(TABLE)
    .select()
    .eq('call_id', callId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error('Failed to get postcall report', { error: error.message, callId });
    throw error;
  }

  return mapRow(result);
}

function mapRow(row: Record<string, unknown>): PostcallReport {
  return {
    id: row.id as string,
    callId: row.call_id as string,
    summary: row.summary as string,
    intent: row.intent as string,
    outcome: row.outcome as string,
    followUpRequired: row.follow_up_required as boolean,
    followUpAt: (row.follow_up_at as string) ?? null,
    crmNote: row.crm_note as string,
    qaFlagsJson: row.qa_flags_json,
    sentiment: row.sentiment as PostcallReport['sentiment'],
    createdAt: row.created_at as string,
  };
}
