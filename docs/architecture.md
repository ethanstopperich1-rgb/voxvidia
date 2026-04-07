# VoxVidia Architecture

## Overview
VoxVidia is a production voice agent system built around NVIDIA PersonaPlex. It connects phone calls via Twilio to a real-time speech-to-speech AI model, with tool orchestration for CRM/calendar actions and post-call analytics.

## System Architecture
```
Phone Caller
  → Twilio Voice (webhook)
  → Twilio Media Stream (WebSocket)
  → VoxVidia Bridge (Render — always on)
    → Audio conversion (mulaw 8kHz ↔ PCM 24kHz)
    → PersonaPlex GPU (RunPod — on-demand)
  → Orchestrator (intent detection + tool execution)
    → CRM API (GoHighLevel)
    → Calendar API (Google Calendar)
  → Post-call Worker (async)
    → Summarizer
    → Outbound Webhooks (CRM, Slack, Analytics)
  → Supabase (calls, transcripts, tool events, reports)
```

## Services

### Bridge (`apps/bridge/`)
- Express + WebSocket server
- Handles Twilio Media Stream lifecycle
- Converts audio between Twilio (mulaw 8kHz) and PersonaPlex (PCM 24kHz)
- Manages per-call sessions
- Accumulates transcript from PersonaPlex text tokens
- Deployed on Render (always-on, WebSocket support)

### Orchestrator (`apps/orchestrator/`)
- Intent detection via pattern matching on transcript
- Tool execution with timeout handling
- Confirmation policy for write actions
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

## PersonaPlex Protocol
Binary WebSocket protocol:
- `0x00` — Handshake (server ready)
- `0x01` — Audio data (Opus encoded)
- `0x02` — Text token (UTF-8, streaming)

## Audio Pipeline
```
Twilio (mulaw 8kHz base64)
  → base64 decode
  → mulaw → PCM int16
  → resample 8kHz → 24kHz
  → send to PersonaPlex

PersonaPlex (Opus 24kHz)
  → decode Opus → PCM
  → resample 24kHz → 8kHz
  → PCM → mulaw
  → base64 encode
  → send to Twilio
```
