// ── Intent Router ────────────────────────────────────────────────────────────
// Pattern-matching intent detection for voice utterances.
// Maps natural-language phrases to tool names + extracted arguments.

export type ToolType = 'read' | 'write';

export interface IntentRule {
  patterns: RegExp[];
  toolName: string;
  type: ToolType;
  extractArgs: (match: RegExpMatchArray, utterance: string) => Record<string, unknown>;
}

export interface DetectedIntent {
  toolName: string;
  type: ToolType;
  args: Record<string, unknown>;
}

// ── Helper: extract a quoted or trailing phrase after a keyword ──────────────

function extractAfter(utterance: string, keyword: string): string {
  const idx = utterance.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return '';
  return utterance.slice(idx + keyword.length).trim().replace(/[?.!]+$/, '');
}

function extractPhoneDigits(utterance: string): string | null {
  const digits = utterance.replace(/\D/g, '');
  if (digits.length >= 7) return digits;
  return null;
}

// ── Seed Rules ──────────────────────────────────────────────────────────────

const RULES: IntentRule[] = [
  // ── READ: calendar ──
  {
    patterns: [
      /what(?:'s| is| are)?\s+(?:my\s+)?(?:meetings?|calendar|schedule)\s+(?:for\s+)?today/i,
      /(?:meetings?|calendar|schedule)\s+today/i,
      /today(?:'s)?\s+(?:meetings?|calendar|schedule)/i,
      /what\s+do\s+i\s+have\s+today/i,
    ],
    toolName: 'get_today_calendar_events',
    type: 'read',
    extractArgs: (_match, _utterance) => ({
      timezone: 'America/New_York',
    }),
  },
  {
    patterns: [
      /(?:what(?:'s| is))?\s*(?:my\s+)?next\s+(?:meeting|appointment|event)/i,
      /(?:when(?:'s| is))?\s*(?:my\s+)?next\s+(?:meeting|appointment)/i,
      /(?:do\s+i\s+have\s+)?(?:anything|something)\s+coming\s+up/i,
    ],
    toolName: 'get_next_meeting',
    type: 'read',
    extractArgs: () => ({}),
  },

  // ── READ: CRM ──
  {
    patterns: [
      /(?:look\s+up|find|search(?:\s+for)?|who\s+is)\s+(?:the\s+)?contact/i,
      /who\s+is\s+calling/i,
      /(?:look\s+up|find)\s+(?:the\s+)?(?:caller|number|phone)/i,
    ],
    toolName: 'find_contact_by_phone',
    type: 'read',
    extractArgs: (_match, utterance) => ({
      phone: extractPhoneDigits(utterance) ?? '',
    }),
  },
  {
    patterns: [
      /account\s+summary/i,
      /account\s+info(?:rmation)?/i,
      /(?:tell\s+me|get|pull(?:\s+up)?)\s+(?:the\s+)?account/i,
    ],
    toolName: 'get_account_summary',
    type: 'read',
    extractArgs: (_match, utterance) => ({
      accountId: extractAfter(utterance, 'account') || undefined,
    }),
  },
  {
    patterns: [
      /(?:deal|deals)\s+status/i,
      /open\s+deals/i,
      /(?:active|current)\s+deals/i,
      /(?:what|any)\s+(?:open|active)\s+deals/i,
    ],
    toolName: 'get_open_deals',
    type: 'read',
    extractArgs: () => ({}),
  },

  // ── WRITE: calendar ──
  {
    patterns: [
      /(?:book|schedule|create|set\s+up)\s+(?:a\s+)?(?:meeting|appointment|event|call)/i,
    ],
    toolName: 'create_calendar_event',
    type: 'write',
    extractArgs: (_match, utterance) => {
      const lower = utterance.toLowerCase();
      const timeMatch = lower.match(/(?:at|for)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      const dateMatch = lower.match(/(?:on|for)\s+(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/\-]\d{1,2})/i);
      return {
        time: timeMatch?.[1] ?? undefined,
        date: dateMatch?.[1] ?? 'tomorrow',
        rawUtterance: utterance,
      };
    },
  },
  {
    patterns: [
      /(?:reschedule|move|change|push)\s+(?:the\s+|my\s+)?(?:meeting|appointment|event)/i,
    ],
    toolName: 'reschedule_event',
    type: 'write',
    extractArgs: (_match, utterance) => {
      const lower = utterance.toLowerCase();
      const toMatch = lower.match(/to\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      return {
        newTime: toMatch?.[1] ?? undefined,
        rawUtterance: utterance,
      };
    },
  },

  // ── WRITE: CRM ──
  {
    patterns: [
      /(?:add|create|make)\s+(?:a\s+)?note/i,
      /(?:log|write)\s+(?:that|this|a\s+note)/i,
      /(?:note\s+that|jot\s+(?:that\s+)?down)/i,
    ],
    toolName: 'create_crm_note',
    type: 'write',
    extractArgs: (_match, utterance) => ({
      note: extractAfter(utterance, 'note') || extractAfter(utterance, 'that') || utterance,
    }),
  },
  {
    patterns: [
      /(?:create|set|add|schedule)\s+(?:a\s+)?follow[\s-]?up/i,
      /follow[\s-]?up\s+(?:task|reminder)/i,
    ],
    toolName: 'create_followup_task',
    type: 'write',
    extractArgs: (_match, utterance) => {
      const lower = utterance.toLowerCase();
      const dateMatch = lower.match(/(?:in|for)\s+(\d+)\s+(day|days|week|weeks)/i);
      return {
        description: extractAfter(utterance, 'follow') || utterance,
        daysOut: dateMatch ? parseInt(dateMatch[1], 10) * (dateMatch[2].startsWith('week') ? 7 : 1) : 1,
      };
    },
  },
];

// ── IntentRouter Class ──────────────────────────────────────────────────────

export class IntentRouter {
  private rules: IntentRule[];

  constructor(customRules?: IntentRule[]) {
    this.rules = customRules ?? RULES;
  }

  detectIntent(utterance: string): DetectedIntent | null {
    const trimmed = utterance.trim();
    if (!trimmed) return null;

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          return {
            toolName: rule.toolName,
            type: rule.type,
            args: rule.extractArgs(match, trimmed),
          };
        }
      }
    }

    return null;
  }

  addRule(rule: IntentRule): void {
    this.rules.push(rule);
  }

  getRules(): ReadonlyArray<IntentRule> {
    return this.rules;
  }
}
