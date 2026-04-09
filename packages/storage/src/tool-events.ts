import { supabase } from './supabase.js';
import { createLogger } from '@voxvidia/shared';
import type { ToolEvent } from '@voxvidia/shared';

const logger = createLogger('storage:tool-events');
const TABLE = 'call_tool_calls';

export interface LogToolEventInput {
  callId: string;
  toolName: string;
  direction: ToolEvent['direction'];
  payloadJson: unknown;
  status: ToolEvent['status'];
  latencyMs?: number | null;
}

export async function logToolEvent(data: LogToolEventInput): Promise<ToolEvent | null> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping logToolEvent');
    return null;
  }

  const row = {
    call_id: data.callId,
    tool_name: data.toolName,
    direction: data.direction,
    payload_json: data.payloadJson,
    status: data.status,
    latency_ms: data.latencyMs ?? null,
  };

  const { data: result, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error('Failed to log tool event', { error: error.message, callId: data.callId });
    throw error;
  }

  return mapRow(result);
}

export async function getToolEventsForCall(callId: string): Promise<ToolEvent[]> {
  if (!supabase) {
    logger.warn('Supabase not configured — skipping getToolEventsForCall');
    return [];
  }

  const { data: results, error } = await supabase
    .from(TABLE)
    .select()
    .eq('call_id', callId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to get tool events', { error: error.message, callId });
    throw error;
  }

  return (results ?? []).map(mapRow);
}

function mapRow(row: Record<string, unknown>): ToolEvent {
  return {
    id: row.id as string,
    callId: row.call_id as string,
    toolName: row.tool_name as string,
    direction: row.direction as ToolEvent['direction'],
    payloadJson: row.payload_json,
    status: row.status as ToolEvent['status'],
    latencyMs: (row.latency_ms as number) ?? null,
    createdAt: row.created_at as string,
  };
}
