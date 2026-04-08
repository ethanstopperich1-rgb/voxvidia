/**
 * GPT-4.1 mini LLM Client with Function Calling
 *
 * Handles conversation orchestration, response generation, and tool calling.
 * Uses OpenAI's streaming API for low-latency token delivery to TTS.
 *
 * Architecture:
 * - System prompt: dealer persona + rules + context (cached after first turn)
 * - User messages: caller transcripts from Deepgram
 * - Assistant messages: previous AI responses
 * - Function calls: tool definitions for CRM/calendar actions
 * - Streaming: tokens forwarded to Rime TTS as they arrive
 */

import { createLogger } from '@voxvidia/shared';

const logger = createLogger('bridge:llm');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4.1-mini';

// ── Tool Definitions ─────────────────────────────────────────────────────────

export const VOICE_AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_buyback_lead_context',
      description: 'Fetch lead data from QR/mailer session. Call at the START of every call to load the customer context.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_session_id: { type: ['string', 'null'], description: 'Session ID from QR scan or mailer link' },
          caller_phone: { type: ['string', 'null'], description: 'E.164 caller phone number' },
          mailer_code: { type: ['string', 'null'], description: 'Unique code printed on the postcard mailer' },
        },
        required: ['lead_session_id', 'caller_phone', 'mailer_code'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_lead_status',
      description: 'Record ownership status and interest level for the lead. Call after confirming whether they still have their vehicle.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'The lead ID from get_buyback_lead_context' },
          still_owns_vehicle: { type: ['boolean', 'null'], description: 'Whether the customer still owns the vehicle' },
          interest_level: {
            type: ['string', 'null'],
            enum: ['interested', 'curious', 'not_interested', 'wrong_person', 'unknown', null],
            description: 'Customer interest level in the buyback offer',
          },
          vehicle_disposition: {
            type: ['string', 'null'],
            enum: ['still_has_vehicle', 'sold_vehicle', 'traded_vehicle', 'unsure', null],
            description: 'What happened to the vehicle',
          },
          notes: { type: ['string', 'null'], description: 'Free-text notes about the interaction' },
        },
        required: ['lead_id', 'still_owns_vehicle', 'interest_level', 'vehicle_disposition', 'notes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_appraisal_slots',
      description: 'Return available VIP appraisal appointment slots. Call BEFORE offering any times.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'The lead ID' },
          preferred_day_text: { type: ['string', 'null'], description: 'Preferred day in natural language, e.g. "Friday" or "this week"' },
          preferred_time_bucket: {
            type: ['string', 'null'],
            enum: ['morning', 'afternoon', 'evening', 'no_preference', null],
            description: 'Preferred time of day',
          },
          max_slots_to_return: { type: 'integer', description: 'Maximum number of slots to return (default 2)' },
        },
        required: ['lead_id', 'preferred_day_text', 'preferred_time_bucket', 'max_slots_to_return'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'book_appraisal_appointment',
      description: 'Book a 15-minute VIP appraisal appointment. ONLY after caller explicitly confirms.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'The lead ID' },
          selected_slot_id: { type: 'string', description: 'Slot ID from get_appraisal_slots' },
          customer_confirmed_slot: { type: 'boolean', description: 'Whether the customer verbally confirmed this slot' },
          callback_phone: { type: ['string', 'null'], description: 'Phone number for confirmation texts' },
          appointment_type: { type: 'string', enum: ['vip_buyback_appraisal'], description: 'Appointment type' },
          notes: { type: ['string', 'null'], description: 'Additional notes for the appointment' },
        },
        required: ['lead_id', 'selected_slot_id', 'customer_confirmed_slot', 'callback_phone', 'appointment_type', 'notes'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_callback_number',
      description: 'Save the customer callback phone number.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'The lead ID' },
          callback_phone_raw: { type: 'string', description: 'Raw phone number as spoken by the customer' },
          customer_confirmed_digits: { type: 'boolean', description: 'Whether the customer confirmed the digits read back' },
        },
        required: ['lead_id', 'callback_phone_raw', 'customer_confirmed_digits'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'transfer_to_vip_desk',
      description: 'Transfer the call to the live VIP team. Use when caller requests a human, asks valuation questions, or is a hot lead.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: ['string', 'null'], description: 'The lead ID if available' },
          transfer_reason: {
            type: 'string',
            enum: ['requested_human', 'valuation_question', 'complex_question', 'hot_lead_live_handoff', 'callback_request', 'other'],
            description: 'Reason for the transfer',
          },
        },
        required: ['lead_id', 'transfer_reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'log_call_outcome',
      description: 'Save the final structured call outcome. Call at the END of every call.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: ['string', 'null'], description: 'The lead ID if available' },
          final_outcome: {
            type: 'string',
            enum: ['appointment_booked', 'interested_no_time_selected', 'not_interested', 'no_longer_has_vehicle', 'wrong_person', 'transferred_to_human', 'requested_callback', 'call_dropped', 'other'],
            description: 'Final call disposition',
          },
          follow_up_needed: { type: 'boolean', description: 'Whether a follow-up call or action is needed' },
          summary_note: { type: ['string', 'null'], description: 'Brief summary of the call' },
        },
        required: ['lead_id', 'final_outcome', 'follow_up_needed', 'summary_note'],
        additionalProperties: false,
      },
    },
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmStreamCallbacks {
  /** Called with each text token as it's generated. Forward to TTS. */
  onToken: (token: string) => void;
  /** Called when a function call is detected. Execute the tool, then call continueAfterTool(). */
  onToolCall: (toolCall: ToolCall) => void;
  /** Called when the full response is complete. */
  onDone: (fullText: string) => void;
  /** Called on error. */
  onError: (err: Error) => void;
}

// ── Filler Phrases ──────────────────────────────────────────────────────────

const FILLER_PHRASES: Record<string, string> = {
  get_buyback_lead_context: 'One moment while I pull up your information.',
  update_lead_status: '',
  get_appraisal_slots: 'Let me check what times we have available for you.',
  book_appraisal_appointment: 'Great, let me lock that in for you.',
  save_callback_number: '',
  transfer_to_vip_desk: 'Let me connect you with our VIP team right now.',
  log_call_outcome: '',
  default: 'One moment please.',
};

export function getFillerPhrase(toolName: string): string {
  return FILLER_PHRASES[toolName] || FILLER_PHRASES.default;
}

// ── Streaming Chat Completion ───────────────────────────────────────────────

/**
 * Send a streaming chat completion request to GPT-4.1 mini.
 * Tokens are forwarded to TTS as they arrive.
 * Function calls are detected and routed to the tool runner.
 */
export async function streamChatCompletion(
  apiKey: string,
  messages: ChatMessage[],
  callbacks: LlmStreamCallbacks,
  callId?: string,
): Promise<void> {
  const startTime = Date.now();

  logger.debug('LLM request', {
    callId,
    messageCount: messages.length,
    lastMessage: messages[messages.length - 1]?.content?.substring(0, 80),
  });

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: VOICE_AGENT_TOOLS,
        parallel_tool_calls: false,
        stream: true,
        temperature: 0.3, // Low temp for consistent, factual responses
        max_tokens: 150, // Keep voice responses SHORT
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let currentToolCall: { id: string; name: string; args: string } | null = null;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          // Stream complete
          if (currentToolCall) {
            callbacks.onToolCall({
              id: currentToolCall.id,
              type: 'function',
              function: {
                name: currentToolCall.name,
                arguments: currentToolCall.args,
              },
            });
          } else {
            callbacks.onDone(fullText);
          }
          const latency = Date.now() - startTime;
          logger.info('LLM response complete', { callId, latency, textLength: fullText.length });
          return;
        }

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            fullText += delta.content;
            callbacks.onToken(delta.content);
          }

          // Function call
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) {
                // New tool call starting
                currentToolCall = {
                  id: tc.id,
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || '',
                };
              } else if (currentToolCall) {
                // Continuing to stream function arguments
                if (tc.function?.name) currentToolCall.name += tc.function.name;
                if (tc.function?.arguments) currentToolCall.args += tc.function.arguments;
              }
            }
          }

          // Finish reason
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (finishReason === 'tool_calls' && currentToolCall) {
            callbacks.onToolCall({
              id: currentToolCall.id,
              type: 'function',
              function: {
                name: currentToolCall.name,
                arguments: currentToolCall.args,
              },
            });
            const latency = Date.now() - startTime;
            logger.info('LLM tool call', { callId, latency, tool: currentToolCall.name });
            return;
          }
          if (finishReason === 'stop') {
            callbacks.onDone(fullText);
            const latency = Date.now() - startTime;
            logger.info('LLM response complete', { callId, latency, textLength: fullText.length });
            return;
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } catch (err) {
    logger.error('LLM error', {
      callId,
      error: err instanceof Error ? err.message : String(err),
    });
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ── System Prompt Builder ───────────────────────────────────────────────────

/**
 * Build the system prompt for a VIP buyback voice agent.
 * Includes persona, rules, and dynamically injected context.
 */
export function buildSystemPrompt(opts: {
  agentName?: string;
  companyName?: string;
  customPrompt?: string;
  callerName?: string;
  callerPhone?: string;
  contactId?: string;
  vehicleInfo?: string;
  dealerHours?: string;
  dealerAddress?: string;
  currentDateTime?: string;
  leadSessionId?: string;
  mailerCode?: string;
}): string {
  const {
    agentName = 'Maria',
    companyName = 'Orlando Motors',
    customPrompt,
    callerName,
    callerPhone,
    contactId,
    vehicleInfo,
    dealerHours,
    dealerAddress,
    currentDateTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    leadSessionId,
    mailerCode,
  } = opts;

  // Use custom prompt if provided (dealer-specific override)
  if (customPrompt) {
    let prompt = customPrompt;
    prompt += `\n\n# Current Call Context\nDate and time: ${currentDateTime}`;
    if (callerName) prompt += `\nCaller name: ${callerName}`;
    if (callerPhone) prompt += `\nCaller phone: ${callerPhone}`;
    if (contactId) prompt += `\nLead ID: ${contactId}`;
    if (vehicleInfo) prompt += `\nVehicle: ${vehicleInfo}`;
    if (leadSessionId) prompt += `\nLead session ID: ${leadSessionId}`;
    if (mailerCode) prompt += `\nMailer code: ${mailerCode}`;
    return prompt;
  }

  // Default VIP buyback system prompt
  return `# Role & Identity
You are ${agentName}, a VIP buyback specialist at ${companyName}.
You are on a live phone call. The caller scanned a QR code on their personalized buyback mailer.
You already know their name and vehicle from the lead context.
Sound warm, calm, and professional — like a friendly person at the dealership.

# Voice & Style Rules
- Keep every response to 1-2 short sentences.
- Ask only one question at a time, then wait.
- No markdown, bullet points, emojis, or special characters.
- Speak dates and times naturally: "Friday at ten in the morning."
- Spell out phone numbers digit by digit.

# Business Info
- Hours: ${dealerHours || 'Monday through Saturday 9 AM to 8 PM, Sunday 11 AM to 6 PM'}
- Address: ${dealerAddress || '7820 International Drive, Orlando, Florida 32819'}

# Conversation Flow
1. Greeting: Warmly greet by name. "Hi ${callerName || 'there'}, thanks for checking out our offer! This is ${agentName} with ${companyName}."
2. Confirm vehicle: "I see you have a ${vehicleInfo || 'vehicle on file'} — do you still have it?"
3. If yes → Build interest: "We have strong demand for ${vehicleInfo ? vehicleInfo.split(' ').pop() + 's' : 'vehicles like yours'} right now. We'd love to give you a VIP appraisal — it only takes about 15 minutes."
4. If interested → Offer 2 times: Call get_appraisal_slots, then say "I have [time 1] or [time 2] — which works better?"
5. After they choose → Confirm phone: "And what's the best number to reach you at?"
6. Book it: Call book_appraisal_appointment. Confirm: "You're all set for [day] at [time]. We'll text you a confirmation."
7. If not interested → Thank them warmly and log outcome.
8. If no longer has vehicle → Thank them, update status, log outcome.

# Tool Rules
- NEVER guess availability. Only offer times from get_appraisal_slots.
- NEVER give dollar amounts or trade-in values.
- NEVER mention competitors.
- Before tool calls, say a brief filler phrase.
- After tool returns, summarize naturally and keep moving.
- If a tool fails twice, say "I'll have our team follow up" and collect callback info.

# Interruption Handling
- If interrupted, stop immediately. Acknowledge briefly. Focus on their question.

# Things You Must Never Do
- Never mention tools, APIs, or internal systems.
- Never pressure someone who declines.
- Never give long speeches.

# Current Call Context
Date and time: ${currentDateTime}
${callerName ? `Caller name: ${callerName}` : 'Caller name: Unknown'}
${callerPhone ? `Caller phone: ${callerPhone}` : ''}
${contactId ? `Lead ID: ${contactId}` : ''}
${vehicleInfo ? `Vehicle: ${vehicleInfo}` : ''}
${leadSessionId ? `Lead session ID: ${leadSessionId}` : ''}
${mailerCode ? `Mailer code: ${mailerCode}` : ''}`.trim();
}
