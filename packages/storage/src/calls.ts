import { supabase } from './supabase.js';
import { createLogger } from '@voxvidia/shared';

const logger = createLogger('storage:calls');
const TABLE = 'calls';
const DEALER_ID = '00000000-0000-0000-0000-000000000001'; // Orlando Motors default

export interface CreateCallInput {
  callSid: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  startedAt: string;
}

export async function createCall(data: CreateCallInput): Promise<any> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping createCall');
    return null;
  }

  try {
    const { data: result, error } = await supabase
      .from(TABLE)
      .insert({
        call_sid: data.callSid,
        dealer_id: DEALER_ID,
        from_number: data.fromNumber,
        to_number: data.toNumber,
        status: data.status,
        started_at: data.startedAt,
        direction: 'inbound',
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create call', { error: error.message, callSid: data.callSid });
      return null;
    }
    return result;
  } catch (err: any) {
    logger.error('Failed to create call', { error: err?.message, callSid: data.callSid });
    return null;
  }
}

export async function updateCall(callSid: string, updates: Record<string, any>): Promise<any> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping updateCall');
    return null;
  }

  try {
    const { error } = await supabase.from(TABLE).update(updates).eq('call_sid', callSid);
    if (error) logger.error('Failed to update call', { error: error.message, callSid });
  } catch (err: any) {
    logger.error('Failed to update call', { error: err?.message, callSid });
  }
  return null;
}

export async function getCall(callSid: string): Promise<any> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping getCall');
    return null;
  }

  try {
    const { data, error } = await supabase.from(TABLE).select().eq('call_sid', callSid).single();
    if (error) return null;
    return data;
  } catch (_err) {
    return null;
  }
}

export async function completeCall(callSid: string, endedAt: string, recordingUrl?: string | null): Promise<any> {
  return updateCall(callSid, { status: 'completed', ended_at: endedAt, recording_url: recordingUrl || null });
}
