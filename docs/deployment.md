# VoxVidia Deployment Guide

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Twilio account with a phone number
- Deepgram API key ([console.deepgram.com](https://console.deepgram.com))
- OpenAI API key ([platform.openai.com](https://platform.openai.com))
- Rime API key ([rime.ai](https://rime.ai))
- Render account (for bridge hosting)
- Supabase project (optional — for call logging + analytics)

## Local Development

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your API keys

# Build all packages
pnpm build

# Start bridge in dev mode
pnpm dev
```

## Render Deployment

1. Push this repo to GitHub
2. In Render dashboard, create a new Web Service
3. Connect the GitHub repo
4. Runtime: Docker (uses the included Dockerfile)
5. Plan: Starter (512MB is sufficient — no GPU, no Python)
6. Add environment variables (see `.env.example`):
   - `DEEPGRAM_API_KEY`
   - `OPENAI_API_KEY`
   - `RIME_API_KEY`
   - `RIME_VOICE` = `cove`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER`
   - `AGENT_NAME` = `Maria`
   - `COMPANY_NAME` = `Orlando Motors`

Or use `render.yaml` for Blueprint deployment (auto-configures everything).

## Twilio Configuration

1. Go to Phone Numbers → your number → Voice Configuration
2. Set "A call comes in" webhook to: `https://<render-url>/twilio/voice` (POST)
3. Set "Call status changes" to: `https://<render-url>/twilio/status` (POST)

## Outbound Calls

### Basic outbound
```bash
curl -X POST https://<render-url>/api/outbound \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "prompt": "You are Maria at Orlando Motors. Call John about his service appointment.",
    "voice": "cove"
  }'
```

### Enriched outbound (auto-injects CRM + Calendar context)
```bash
curl -X POST https://<render-url>/api/outbound/enriched \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "templatePrompt": "Follow up on the service appointment we discussed yesterday."
  }'
```

## Supabase Setup (Optional)

1. Create a new Supabase project
2. Run the migration: `supabase/migrations/001_personaplex_schema.sql`
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to environment variables

## CRM + Calendar Integration

Set `USE_STUB_ADAPTERS=false` and configure:

**GoHighLevel CRM:**
- `CRM_BASE_URL` — GHL API base URL
- `CRM_API_KEY` — GHL API key

**Google Calendar:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (default: `primary`)

When stub adapters are enabled (default), tools return realistic fake data for testing.

## Health Check

```bash
curl https://<render-url>/health
# Returns: { "status": "ok", "activeCalls": 0, "stack": "deepgram-nova3 + gpt-4.1-mini + rime-mistv3" }
```

## Environment Variables

See `.env.example` for the full list.

**Required:**
- `DEEPGRAM_API_KEY` — Deepgram Nova-3 STT
- `OPENAI_API_KEY` — GPT-4.1 mini LLM
- `RIME_API_KEY` — Rime Mist v3 TTS

**Recommended:**
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` — signature validation + outbound calls
- `AGENT_NAME` + `COMPANY_NAME` — agent persona
- `RIME_VOICE` — Rime speaker ID (default: `cove`)

**Optional:**
- Supabase credentials (call logging)
- CRM/Calendar credentials (tool orchestration)
- Outbound webhook URLs (post-call analytics)
