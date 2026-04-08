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
      name: 'lookup_contact',
      description: 'Look up a contact in the CRM by phone number. Call at the START of every call.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: { type: 'string', description: 'E.164 phone number' },
        },
        required: ['phone_number'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_availability',
      description: 'Check appointment slots. Call BEFORE offering times.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO 8601 date' },
          service_type: {
            type: 'string',
            enum: ['oil_change', 'tire_rotation', 'brake_service', 'general_service', 'recall', 'diagnostic', 'test_drive', 'sales_consultation'],
          },
          time_preference: { type: 'string', enum: ['morning', 'afternoon', 'any'] },
        },
        required: ['date', 'service_type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'book_appointment',
      description: 'Book a confirmed appointment. ONLY after caller explicitly confirms.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          date: { type: 'string' },
          time: { type: 'string', description: 'HH:MM 24hr' },
          service_type: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['contact_id', 'date', 'time', 'service_type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'transfer_to_human',
      description: 'Transfer call to human agent. Use when: caller requests human, request is outside AI capabilities, or caller is frustrated.',
      parameters: {
        type: 'object',
        properties: {
          department: { type: 'string', enum: ['service', 'sales', 'parts', 'finance', 'manager'] },
          reason: { type: 'string' },
        },
        required: ['department', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_follow_up_sms',
      description: 'Send SMS confirmation after booking.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          message: { type: 'string', maxLength: 320 },
        },
        required: ['contact_id', 'message'],
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
  lookup_contact: 'One moment while I pull up your information.',
  check_availability: 'Let me check what we have available.',
  book_appointment: "Great, I'm booking that right now.",
  transfer_to_human: 'Let me connect you with our team.',
  send_follow_up_sms: "I'll send you a text with those details.",
  default: 'Let me look into that for you.',
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
 * Build the system prompt for a dealership voice agent.
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
}): string {
  const {
    agentName = 'the AI assistant',
    companyName = 'the dealership',
    customPrompt,
    callerName,
    callerPhone,
    contactId,
    vehicleInfo,
    dealerHours,
    dealerAddress,
    currentDateTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
  } = opts;

  // Use custom prompt if provided (dealer-specific)
  if (customPrompt) {
    let prompt = customPrompt;
    // Inject dynamic context at the end
    prompt += `\n\n# Current Call Context\nDate and time: ${currentDateTime}`;
    if (callerName) prompt += `\nCaller name: ${callerName}`;
    if (callerPhone) prompt += `\nCaller phone: ${callerPhone}`;
    if (contactId) prompt += `\nCRM contact ID: ${contactId}`;
    if (vehicleInfo) prompt += `\nVehicle: ${vehicleInfo}`;
    return prompt;
  }

  // Default system prompt
  return `# Identity
You are ${agentName}, an AI assistant at ${companyName}.
Tone: warm, concise, professional.
Keep every response to 1-2 short sentences. Use contractions. Sound natural.

# Current Call Context
Date and time: ${currentDateTime}
${callerName ? `Caller name: ${callerName}` : 'Caller name: Unknown'}
${callerPhone ? `Caller phone: ${callerPhone}` : ''}
${contactId ? `CRM contact ID: ${contactId}` : ''}
${vehicleInfo ? `Vehicle: ${vehicleInfo}` : ''}

# Dealership Info
${dealerHours ? `Hours: ${dealerHours}` : ''}
${dealerAddress ? `Address: ${dealerAddress}` : ''}

# Rules
ALWAYS:
- Disclose you are an AI assistant at the start: "Hi, this is ${agentName}, an AI assistant with ${companyName}."
- Use the caller's first name after the greeting
- Confirm any booking action out loud before executing
- Speak numbers naturally ("two fifteen PM", not "2:15 PM")

NEVER:
- Invent information not in your context
- Give dollar amounts or price quotes (say "prices vary, the advisor will confirm")
- Mention competitors
- Say "I don't know" without offering an alternative
- Use filler phrases: "Certainly!", "Absolutely!", "Of course!"

# When to Transfer
If the caller: asks for a human, sounds frustrated, asks about pricing details,
or has a question you can't answer — transfer immediately. Say:
"Let me connect you with our team right now."`.trim();
}
