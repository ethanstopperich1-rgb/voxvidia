// ── Orchestrator ─────────────────────────────────────────────────────────────
// Central coordinator for PersonaPlex voice agent tool execution.
// Receives raw utterances, detects intent, manages confirmation for writes,
// and returns voice-ready responses.

import { createLogger } from '@voxvidia/shared';
import { IntentRouter, type DetectedIntent } from './intent-router.js';
import { ToolRunner, ToolRegistry, type ToolResult } from './tool-runner.js';
import { ConfirmationPolicy } from './confirmation.js';
import {
  formatCalendarEvents,
  formatNextMeeting,
  formatContact,
  formatDeals,
  formatAccountSummary,
  formatSuccess,
  formatError,
  type CalendarEvent,
  type Contact,
  type Deal,
} from './speakable.js';

export type OrchestratorAction = 'none' | 'speak' | 'confirm';

export interface OrchestratorResult {
  action: OrchestratorAction;
  text?: string;
  toolName?: string;
  latencyMs?: number;
}

export interface OrchestratorDeps {
  intentRouter: IntentRouter;
  toolRunner: ToolRunner;
  confirmationPolicy: ConfirmationPolicy;
}

const logger = createLogger('orchestrator');

export class Orchestrator {
  private intentRouter: IntentRouter;
  private toolRunner: ToolRunner;
  private confirmationPolicy: ConfirmationPolicy;

  constructor(deps: OrchestratorDeps) {
    this.intentRouter = deps.intentRouter;
    this.toolRunner = deps.toolRunner;
    this.confirmationPolicy = deps.confirmationPolicy;
  }

  async processUtterance(callSid: string, utterance: string): Promise<OrchestratorResult> {
    const trimmed = utterance.trim();
    if (!trimmed) {
      return { action: 'none' };
    }

    // ── Check for pending confirmation response ──
    if (this.confirmationPolicy.hasPending(callSid)) {
      return this.handleConfirmationResponse(callSid, trimmed);
    }

    // ── Detect intent ──
    const intent = this.intentRouter.detectIntent(trimmed);
    if (!intent) {
      logger.debug('No intent matched', { callId: callSid, utterance: trimmed });
      return { action: 'none' };
    }

    logger.info(`Intent detected: ${intent.toolName} (${intent.type})`, {
      callId: callSid,
      toolName: intent.toolName,
    } as Record<string, unknown>);

    // ── Read tools: execute immediately ──
    if (intent.type === 'read') {
      return this.executeReadTool(callSid, intent);
    }

    // ── Write tools: request confirmation first ──
    const confirmText = this.confirmationPolicy.requestConfirmation(
      callSid,
      intent.toolName,
      intent.args,
    );

    return {
      action: 'confirm',
      text: confirmText,
      toolName: intent.toolName,
    };
  }

  /** Clean up per-call state when a call ends. */
  endCall(callSid: string): void {
    this.confirmationPolicy.clearCall(callSid);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async handleConfirmationResponse(
    callSid: string,
    utterance: string,
  ): Promise<OrchestratorResult> {
    // Check for negation first
    if (this.confirmationPolicy.isNegation(utterance)) {
      this.confirmationPolicy.cancelConfirmation(callSid);
      return {
        action: 'speak',
        text: 'Okay, cancelled.',
      };
    }

    // Check for positive confirmation
    if (this.confirmationPolicy.checkConfirmation(callSid, utterance)) {
      const pending = this.confirmationPolicy.getPending(callSid);
      if (!pending) {
        return { action: 'none' };
      }

      this.confirmationPolicy.cancelConfirmation(callSid);

      const result = await this.toolRunner.runTool(pending.toolName, pending.args);

      if (result.success) {
        return {
          action: 'speak',
          text: formatSuccess(pending.toolName, result.data),
          toolName: pending.toolName,
          latencyMs: result.latencyMs,
        };
      }

      return {
        action: 'speak',
        text: formatError(pending.toolName, result.error ?? 'Unknown error'),
        toolName: pending.toolName,
        latencyMs: result.latencyMs,
      };
    }

    // Ambiguous response: re-ask
    const pending = this.confirmationPolicy.getPending(callSid);
    return {
      action: 'confirm',
      text: `Sorry, I didn't catch that. ${pending?.description ?? 'Should I go ahead?'}`,
      toolName: pending?.toolName,
    };
  }

  private async executeReadTool(
    callSid: string,
    intent: DetectedIntent,
  ): Promise<OrchestratorResult> {
    const result: ToolResult = await this.toolRunner.runTool(intent.toolName, intent.args);

    if (!result.success) {
      return {
        action: 'speak',
        text: formatError(intent.toolName, result.error ?? 'Unknown error'),
        toolName: intent.toolName,
        latencyMs: result.latencyMs,
      };
    }

    const text = this.formatReadResult(intent.toolName, result.data);

    return {
      action: 'speak',
      text,
      toolName: intent.toolName,
      latencyMs: result.latencyMs,
    };
  }

  private formatReadResult(toolName: string, data: unknown): string {
    switch (toolName) {
      case 'get_today_calendar_events':
        return formatCalendarEvents(data as CalendarEvent[]);

      case 'get_next_meeting':
        return formatNextMeeting(data as CalendarEvent | null);

      case 'find_contact_by_phone':
        return formatContact(data as Contact | null);

      case 'get_open_deals':
        return formatDeals(data as Deal[]);

      case 'get_account_summary':
        return formatAccountSummary(data as Record<string, unknown> | null);

      default:
        return data ? String(data) : 'Done.';
    }
  }
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export { IntentRouter, type IntentRule, type DetectedIntent, type ToolType } from './intent-router.js';
export { ToolRunner, ToolRegistry, type ToolHandler, type ToolResult } from './tool-runner.js';
export { ConfirmationPolicy, type PendingAction, type ConfirmationState } from './confirmation.js';

export {
  formatCalendarEvents,
  formatNextMeeting,
  formatContact,
  formatDeals,
  formatAccountSummary,
  formatConfirmation,
  formatSuccess,
  formatError,
} from './speakable.js';
export type { CalendarEvent, Contact, Deal } from './speakable.js';

export type {
  CalendarAdapter,
  CreateEventPayload,
  ReschedulePayload,
  GoogleCalendarConfig,
} from './adapters/calendar.js';
export { StubCalendarAdapter, GoogleCalendarAdapter } from './adapters/calendar.js';

export type {
  CrmAdapter,
  Contact as CrmContact,
  AccountSummary,
  Deal as CrmDeal,
  CreateNotePayload,
  CreateFollowupPayload,
  GhlConfig,
} from './adapters/crm.js';
export { StubCrmAdapter, GhlCrmAdapter } from './adapters/crm.js';

export { registerCalendarTools } from './tools/calendar-tools.js';
export { registerCrmTools } from './tools/crm-tools.js';
