// ── Post-Call Worker ─────────────────────────────────────────────────────────
// Orchestrates the full post-call analysis pipeline:
// 1. Load call record, transcript, tool events from DB
// 2. Run heuristic summarizer
// 3. Store report in DB
// 4. Fire outbound webhooks

import { createLogger } from '@voxvidia/shared';
import type { CallRecord, TranscriptEvent, ToolEvent, PostcallReport } from '@voxvidia/shared';
import {
  getCall,
  getTranscriptForCall,
  getToolEventsForCall,
  createReport,
} from '@voxvidia/storage';
import { summarizeCall, type CallMeta } from './summarizer.js';
import { deliverPostcallWebhooks } from './webhooks.js';

const logger = createLogger('workers:postcall');

export interface PostcallWorkerResult {
  success: boolean;
  reportId?: string;
  webhooksSent?: number;
  webhooksFailed?: number;
  error?: string;
  latencyMs: number;
}

export async function processPostCall(callSid: string): Promise<PostcallWorkerResult> {
  const start = performance.now();

  try {
    // ── 1. Load call record ──
    const callRecord = await getCall(callSid);
    if (!callRecord) {
      logger.error(`Call record not found for SID: ${callSid}`);
      return {
        success: false,
        error: `Call record not found: ${callSid}`,
        latencyMs: elapsed(start),
      };
    }

    logger.info(`Processing post-call for ${callSid}`, { callId: callRecord.id });

    // ── 2. Load transcript and tool events ──
    const [transcriptEvents, toolEvents] = await Promise.all([
      getTranscriptForCall(callRecord.id),
      getToolEventsForCall(callRecord.id),
    ]);

    logger.info(
      `Loaded ${transcriptEvents.length} transcript events, ${toolEvents.length} tool events`,
      { callId: callRecord.id },
    );

    if (transcriptEvents.length === 0) {
      logger.warn(`No transcript events found for call ${callSid}, generating minimal report`);
    }

    // ── 3. Build call metadata ──
    const durationSeconds = computeDuration(callRecord);
    const callMeta: CallMeta = {
      callSid: callRecord.callSid,
      callId: callRecord.id,
      fromNumber: callRecord.fromNumber,
      toNumber: callRecord.toNumber,
      startedAt: callRecord.startedAt,
      endedAt: callRecord.endedAt,
      durationSeconds,
    };

    // ── 4. Run summarizer ──
    const reportData = summarizeCall(transcriptEvents, toolEvents, callMeta);

    logger.info(`Summarizer complete: intent=${reportData.intent}, outcome=${reportData.outcome}`, {
      callId: callRecord.id,
    });

    // ── 5. Store report in DB ──
    const report = await createReport({
      callId: callRecord.id,
      summary: reportData.summary,
      intent: reportData.intent,
      outcome: reportData.outcome,
      followUpRequired: reportData.followUpRequired,
      followUpAt: reportData.followUpAt,
      crmNote: reportData.crmNote,
      qaFlagsJson: reportData.qaFlags,
      sentiment: reportData.sentiment,
    });

    const reportId = report?.id ?? 'unknown';
    logger.info(`Report stored: ${reportId}`, { callId: callRecord.id });

    // ── 6. Deliver webhooks ──
    let webhooksSent = 0;
    let webhooksFailed = 0;

    if (report) {
      const webhookResult = await deliverPostcallWebhooks(report, callRecord);
      webhooksSent = webhookResult.sent;
      webhooksFailed = webhookResult.failed;
    }

    return {
      success: true,
      reportId,
      webhooksSent,
      webhooksFailed,
      latencyMs: elapsed(start),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Post-call processing failed for ${callSid}: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      latencyMs: elapsed(start),
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeDuration(callRecord: CallRecord): number | undefined {
  if (!callRecord.startedAt || !callRecord.endedAt) return undefined;

  const start = new Date(callRecord.startedAt).getTime();
  const end = new Date(callRecord.endedAt).getTime();

  if (isNaN(start) || isNaN(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 1000));
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
