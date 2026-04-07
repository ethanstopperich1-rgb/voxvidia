// ── Internal Event Types ─────────────────────────────────────────────────────

export interface CallStartedEvent {
  type: 'call.started';
  callSid: string;
  fromNumber: string;
  toNumber: string;
  timestamp: string;
}

export interface CallEndedEvent {
  type: 'call.ended';
  callSid: string;
  duration: number;
  timestamp: string;
}

export interface TranscriptChunkEvent {
  type: 'transcript.chunk';
  callSid: string;
  speaker: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
}

export interface ToolRequestEvent {
  type: 'tool.request';
  callSid: string;
  toolName: string;
  args: Record<string, unknown>;
  requestId: string;
}

export interface ToolResponseEvent {
  type: 'tool.response';
  callSid: string;
  toolName: string;
  result: unknown;
  requestId: string;
  latencyMs: number;
}

export interface PostcallCompleteEvent {
  type: 'postcall.complete';
  callSid: string;
  reportId: string;
}

export type VoxvidiaEvent =
  | CallStartedEvent
  | CallEndedEvent
  | TranscriptChunkEvent
  | ToolRequestEvent
  | ToolResponseEvent
  | PostcallCompleteEvent;
