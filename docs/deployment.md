# VoxVidia Deployment Guide

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Twilio account with a phone number
- RunPod account with A40/A6000 GPU pod
- Supabase project (optional for MVP)
- Render account (for bridge hosting)

## Local Development

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Build all packages
pnpm build

# Start bridge in dev mode
pnpm dev
```

## RunPod Setup (PersonaPlex GPU)

1. Create a GPU pod (A40 48GB recommended)
2. Expose ports: `8998/http,22/tcp`
3. SSH in and run:
```bash
apt-get update -qq && apt-get install -y -qq libopus-dev git
cd /workspace && git clone https://github.com/NVIDIA/personaplex.git
cd personaplex && pip install ./moshi/
NO_TORCH_COMPILE=1 nohup python -m moshi.server --host 0.0.0.0 --device cuda &
```
4. Note the proxy URL: `wss://<pod-id>-8998.proxy.runpod.net/api/chat`

## Render Deployment (Bridge)

1. Push this repo to GitHub
2. In Render dashboard, create a new Web Service
3. Connect the GitHub repo
4. Set build command: `npm install -g pnpm && pnpm install && pnpm build`
5. Set start command: `node apps/bridge/dist/server.js`
6. Add environment variables:
   - `PERSONAPLEX_WS_URL` = `wss://<pod-id>-8998.proxy.runpod.net/api/chat`
   - `DEFAULT_VOICE` = `NATF2.pt`
   - `DEFAULT_PROMPT` = your agent prompt
   - `TWILIO_ACCOUNT_SID` = your Twilio SID
   - `TWILIO_AUTH_TOKEN` = your Twilio auth token

## Twilio Configuration

1. Go to Phone Numbers → your number → Voice Configuration
2. Set "A call comes in" webhook to: `https://<render-url>/twilio/voice` (POST)
3. Set "Call status changes" to: `https://<render-url>/twilio/status` (POST)

## Supabase Setup (Optional)

1. Create a new Supabase project
2. Run the migration: `supabase/migrations/001_personaplex_schema.sql`
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to environment variables

## Environment Variables

See `.env.example` for the full list. Required for MVP:
- `PORT` — server port (default 3000)
- `PERSONAPLEX_WS_URL` — PersonaPlex WebSocket URL
- `DEFAULT_VOICE` — voice prompt filename
- `DEFAULT_PROMPT` — system prompt text

Optional:
- Twilio credentials (for signature validation)
- Supabase credentials (for call logging)
- CRM/Calendar credentials (for tool orchestration)
- Outbound webhook URLs (for post-call analytics)
