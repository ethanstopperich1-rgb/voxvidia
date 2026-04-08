-- VoxVidia Dashboard Schema
-- Run this in Supabase SQL Editor: supabase.com/dashboard → SQL Editor → New Query

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Dealers ─────────────────────────────────────────────────────────────────
CREATE TABLE dealers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert Orlando Motors as default dealer
INSERT INTO dealers (id, name, phone_number, timezone)
VALUES ('00000000-0000-0000-0000-000000000001', 'Orlando Motors', '+14072890294', 'America/New_York');

-- ── Calls ───────────────────────────────────────────────────────────────────
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_sid TEXT UNIQUE NOT NULL,
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'dropped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Call Analysis ───────────────────────────────────────────────────────────
CREATE TABLE call_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_sid TEXT UNIQUE NOT NULL REFERENCES calls(call_sid),
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  summary TEXT,
  lead_outcome TEXT CHECK (lead_outcome IN (
    'appointment_booked', 'interested_no_time', 'not_interested',
    'no_longer_has_vehicle', 'wrong_person', 'transferred',
    'callback_requested', 'dropped'
  )),
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated')),
  appointment_booked BOOLEAN NOT NULL DEFAULT FALSE,
  appointment_date DATE,
  appointment_time TIME,
  appointment_type TEXT,
  confirmation_code TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_vehicle TEXT,
  still_owns_vehicle BOOLEAN,
  interest_level TEXT,
  follow_up_needed BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_action TEXT,
  follow_up_by_date DATE,
  qa_flags TEXT[] NOT NULL DEFAULT '{}',
  mailer_code TEXT,
  campaign TEXT,
  source TEXT,
  total_duration_seconds INTEGER,
  agent_response_latency_avg_ms INTEGER,
  barge_ins_detected INTEGER NOT NULL DEFAULT 0,
  tool_calls_made INTEGER NOT NULL DEFAULT 0,
  tool_errors INTEGER NOT NULL DEFAULT 0,
  raw_analysis JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Call Transcripts ────────────────────────────────────────────────────────
CREATE TABLE call_transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_sid TEXT NOT NULL REFERENCES calls(call_sid),
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  speaker TEXT NOT NULL CHECK (speaker IN ('agent', 'caller')),
  text TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL DEFAULT 0,
  is_final BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Call Tool Calls ─────────────────────────────────────────────────────────
CREATE TABLE call_tool_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_sid TEXT NOT NULL REFERENCES calls(call_sid),
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  latency_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_calls_dealer_started ON calls(dealer_id, started_at DESC);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_active ON calls(dealer_id, status) WHERE status = 'active';
CREATE INDEX idx_analysis_dealer_outcome ON call_analysis(dealer_id, lead_outcome, created_at DESC);
CREATE INDEX idx_analysis_campaign ON call_analysis(dealer_id, campaign, created_at DESC);
CREATE INDEX idx_analysis_date ON call_analysis(dealer_id, created_at DESC);
CREATE INDEX idx_transcripts_call ON call_transcripts(call_sid, timestamp_ms);
CREATE INDEX idx_tool_calls_call ON call_tool_calls(call_sid, called_at);

-- ── Enable Realtime ─────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE calls;
ALTER PUBLICATION supabase_realtime ADD TABLE call_analysis;

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE dealers ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_tool_calls ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so bridge can write freely.
-- Dashboard users will be gated by dealer_id in JWT.
CREATE POLICY "service_role_full_access" ON dealers FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON calls FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON call_analysis FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON call_transcripts FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON call_tool_calls FOR ALL TO service_role USING (true);

-- Anon/authenticated users see only their dealer's data
CREATE POLICY "dealer_isolation" ON calls FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);
CREATE POLICY "dealer_isolation" ON call_analysis FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);
CREATE POLICY "dealer_isolation" ON call_transcripts FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);
CREATE POLICY "dealer_isolation" ON call_tool_calls FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);
