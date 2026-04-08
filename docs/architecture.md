# VoxVidia Architecture

## Overview
VoxVidia is a production voice agent platform for automotive dealerships. It connects phone calls via Twilio to a three-stage AI pipeline (Deepgram Nova-3 ASR → GPT-4.1 mini LLM → Rime Mist v3 TTS) with tool orchestration for CRM/calendar actions and post-call analytics.

## System Architecture
```
Phone Caller
  → Twilio Voice (webhook → TwiML → Media Stream)
  → Twilio Media Stream (WebSocket, mulaw 8kHz)
  → VoxVidia Bridge (Render — always on)
    → Deepgram Nova-3 STT (WebSocket, 16kHz linear16)
    → GPT-4.1 mini LLM (streaming Chat Completions + tool calling)
    → Rime Mist v3 TTS (ws3 JSON WebSocket, mulaw 8kHz direct to Twilio)
  → Orchestrator (intent detection + tool execution)
    → CRM API (GoHighLevel / stub)
    → Calendar API (Google Calendar / stub)
  → Post-call Worker (async)
    → Summarizer (intent, outcome, sentiment, follow-up, QA flags)
    → Outbound Webhooks (CRM, Slack, Analytics)
  → Supabase (calls, transcripts, tool events, reports)
```

## Services

### Bridge (`apps/bridge/`)
- Express + WebSocket server
- Handles Twilio Media Stream lifecycle (inbound + outbound calls)
- Audio: Twilio mulaw 8kHz → decode → upsample → Deepgram 16kHz linear16
- Audio: Rime mulaw 8kHz → direct to Twilio (zero transcoding)
- LLM tokens stream sentence-by-sentence to Rime for minimum TTFB
- Barge-in: interim transcripts trigger Rime `clear` + Twilio `clear`
- Filler phrases during tool execution ("Let me check what we have available")
- Deployed on Render (always-on, WebSocket support)

### Orchestrator (`apps/orchestrator/`)
- Intent detection via pattern matching on transcript
- Tool execution with timeout handling
- Confirmation policy for write actions (book/reschedule/cancel)
- CRM adapter (GoHighLevel) and Calendar adapter (Google Calendar)
- Speakable response formatting for voice-friendly output

### Workers (`apps/workers/`)
- Post-call analysis triggered on call completion
- Summarizer extracts: intent, outcome, sentiment, follow-up, QA flags
- Outbound webhook delivery to CRM, Slack, analytics

### Shared (`packages/shared/`)
- Zod schemas for all data types
- Structured JSON logger
- Environment variable parsing
- Event type definitions

### Storage (`packages/storage/`)
- Supabase client initialization
- Repository layer for all 4 database tables

## Database Tables
- `pp_calls` — call lifecycle, latency metrics
- `pp_transcript_events` — speaker turns with timestamps
- `pp_tool_events` — tool requests/responses with latency
- `pp_postcall_reports` — structured analysis output

## Audio Pipeline
```
Inbound (caller → AI):
  Twilio (mulaw 8kHz base64)
    → base64 decode
    → mulaw → PCM int16 (lookup table)
    → resample 8kHz → 16kHz (linear interpolation)
    → send to Deepgram Nova-3

AI Response (AI → caller):
  GPT-4.1 mini (streaming text tokens)
    → sentence-chunked to Rime Mist v3
    → Rime outputs mulaw 8kHz directly
    → base64 encode → send to Twilio (zero transcoding)
```

## LLM Tool Calling
GPT-4.1 mini has 5 tools available:
- `lookup_contact` — CRM lookup by phone (called at call start)
- `check_availability` — Calendar slot check (before offering times)
- `book_appointment` — Confirm and book (only after caller confirms)
- `transfer_to_human` — Warm transfer to department
- `send_follow_up_sms` — SMS confirmation after booking

## Latency Budget
| Stage | Target |
|-------|--------|
| Deepgram Nova-3 STT (with endpointing=300ms) | ~200-400ms |
| GPT-4.1 mini TTFT | ~200-400ms |
| Rime Mist v3 TTFB (mulaw 8kHz) | <100ms |
| **Total mouth-to-ear** | **~600-900ms** |

## Cost Per Minute
| Service | Rate |
|---------|------|
| Deepgram Nova-3 | ~$0.0043/min |
| GPT-4.1 mini (~150 tokens/turn) | ~$0.001/min |
| Rime Mist v3 | ~$0.006/min |
| **Total** | **~$0.011/min** |
