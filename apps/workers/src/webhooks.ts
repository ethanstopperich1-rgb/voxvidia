// ── Outbound Webhook Delivery ────────────────────────────────────────────────
// POST webhook payloads to configured URLs with retry + exponential backoff.

import { createLogger, env } from '@voxvidia/shared';
import type { CallRecord, PostcallReport } from '@voxvidia/shared';

const logger = createLogger('workers:webhooks');

// ── Types ───────────────────────────────────────────────────────────────────

export interface WebhookPayload {
  event: 'postcall.report';
  timestamp: string;
  data: {
    callSid: string;
    callId: string;
    fromNumber: string;
    toNumber: string;
    startedAt: string;
    endedAt: string | null;
    summary: string;
    intent: string;
    outcome: string;
    sentiment: string;
    followUpRequired: boolean;
    followUpAt: string | null;
    crmNote: string;
    qaFlags: unknown;
  };
}

// ── Core Webhook Sender ─────────────────────────────────────────────────────

export async function sendWebhook(
  url: string,
  payload: unknown,
  retries: number = 3,
): Promise<boolean> {
  const label = new URL(url).hostname;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Voxvidia-Workers/1.0',
          'X-Voxvidia-Event': 'postcall.report',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        logger.info(`Webhook delivered to ${label}`, {
          status: res.status,
          attempt,
        } as Record<string, unknown>);
        return true;
      }

      logger.warn(`Webhook ${label} returned ${res.status} (attempt ${attempt}/${retries})`, {
        status: res.status,
        attempt,
      } as Record<string, unknown>);
    } catch (err) {
      logger.error(`Webhook ${label} failed (attempt ${attempt}/${retries}): ${String(err)}`, {
        attempt,
      } as Record<string, unknown>);
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < retries) {
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      await sleep(delayMs);
    }
  }

  logger.error(`Webhook ${label} exhausted all ${retries} retries`);
  return false;
}

// ── Build Payload ───────────────────────────────────────────────────────────

export function buildWebhookPayload(
  report: PostcallReport,
  callRecord: CallRecord,
): WebhookPayload {
  return {
    event: 'postcall.report',
    timestamp: new Date().toISOString(),
    data: {
      callSid: callRecord.callSid,
      callId: callRecord.id,
      fromNumber: callRecord.fromNumber,
      toNumber: callRecord.toNumber,
      startedAt: callRecord.startedAt,
      endedAt: callRecord.endedAt,
      summary: report.summary,
      intent: report.intent,
      outcome: report.outcome,
      sentiment: report.sentiment,
      followUpRequired: report.followUpRequired,
      followUpAt: report.followUpAt,
      crmNote: report.crmNote,
      qaFlags: report.qaFlagsJson,
    },
  };
}

// ── Deliver To All Configured Endpoints ─────────────────────────────────────

export async function deliverPostcallWebhooks(
  report: PostcallReport,
  callRecord: CallRecord,
): Promise<{ sent: number; failed: number }> {
  const payload = buildWebhookPayload(report, callRecord);

  const targets: Array<{ name: string; url: string | undefined }> = [
    { name: 'CRM', url: env.OUTBOUND_CRM_WEBHOOK_URL },
    { name: 'Analytics', url: env.OUTBOUND_ANALYTICS_WEBHOOK_URL },
    { name: 'Slack', url: env.OUTBOUND_SLACK_WEBHOOK_URL },
  ];

  const activeTargets = targets.filter((t) => t.url);
  if (activeTargets.length === 0) {
    logger.info('No outbound webhook URLs configured, skipping delivery');
    return { sent: 0, failed: 0 };
  }

  logger.info(`Delivering postcall webhooks to ${activeTargets.length} target(s)`, {
    callId: callRecord.id,
    targets: activeTargets.map((t) => t.name),
  } as Record<string, unknown>);

  const results = await Promise.allSettled(
    activeTargets.map(async (target) => {
      const success = await sendWebhook(target.url!, payload);
      return { name: target.name, success };
    }),
  );

  let sent = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      sent++;
    } else {
      failed++;
    }
  }

  logger.info(`Webhook delivery complete: ${sent} sent, ${failed} failed`, {
    callId: callRecord.id,
  });

  return { sent, failed };
}

// ── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
