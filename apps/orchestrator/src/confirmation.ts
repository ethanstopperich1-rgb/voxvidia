// ── Confirmation Policy ──────────────────────────────────────────────────────
// Manages write-action confirmation state per call.
// Before executing a write tool, the orchestrator asks the caller to confirm.

import { formatConfirmation } from './speakable.js';

export interface PendingAction {
  toolName: string;
  args: Record<string, unknown>;
  description: string;
}

export interface ConfirmationState {
  pendingAction: PendingAction | null;
}

const POSITIVE_PATTERNS = [
  /\byes\b/i,
  /\byeah\b/i,
  /\byep\b/i,
  /\byup\b/i,
  /\bconfirm\b/i,
  /\bgo\s+ahead\b/i,
  /\bdo\s+it\b/i,
  /\bsure\b/i,
  /\bplease\b/i,
  /\babsolutely\b/i,
  /\bsounds\s+good\b/i,
  /\bthat(?:'s)?\s+(?:right|correct|fine)\b/i,
  /\blet(?:'s)?\s+do\s+(?:it|that)\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bno\b/i,
  /\bnope\b/i,
  /\bcancel\b/i,
  /\bdon(?:'t|t)\b/i,
  /\bnever\s+mind\b/i,
  /\bforget\s+(?:it|that)\b/i,
  /\bstop\b/i,
  /\bwait\b/i,
  /\bhold\s+on\b/i,
  /\bactually\s+no\b/i,
  /\bscratch\s+that\b/i,
];

export class ConfirmationPolicy {
  private states: Map<string, ConfirmationState> = new Map();

  private getState(callSid: string): ConfirmationState {
    let state = this.states.get(callSid);
    if (!state) {
      state = { pendingAction: null };
      this.states.set(callSid, state);
    }
    return state;
  }

  hasPending(callSid: string): boolean {
    const state = this.states.get(callSid);
    return state?.pendingAction !== null;
  }

  getPending(callSid: string): PendingAction | null {
    return this.states.get(callSid)?.pendingAction ?? null;
  }

  requestConfirmation(
    callSid: string,
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    const description = formatConfirmation(toolName, args);
    const state = this.getState(callSid);
    state.pendingAction = { toolName, args, description };
    return description;
  }

  checkConfirmation(callSid: string, utterance: string): boolean {
    const state = this.states.get(callSid);
    if (!state?.pendingAction) return false;

    const trimmed = utterance.trim();
    return POSITIVE_PATTERNS.some((p) => p.test(trimmed));
  }

  cancelConfirmation(callSid: string): void {
    const state = this.states.get(callSid);
    if (state) {
      state.pendingAction = null;
    }
  }

  isNegation(utterance: string): boolean {
    const trimmed = utterance.trim();
    return NEGATIVE_PATTERNS.some((p) => p.test(trimmed));
  }

  /** Clean up state when a call ends. */
  clearCall(callSid: string): void {
    this.states.delete(callSid);
  }
}
