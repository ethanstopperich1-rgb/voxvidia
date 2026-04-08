-- VoxVidia voice agent system schema
-- NOTE: personaplex_session_id column retained for backward compatibility
-- Tables prefixed with pp_ to namespace within shared Supabase project

-- ── pp_calls ─────────────────────────────────────────────────────────────────

CREATE TABLE pp_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_sid        TEXT NOT NULL,
    from_number     TEXT NOT NULL,
    to_number       TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('initiated', 'ringing', 'answered', 'completed', 'failed')),
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    recording_url   TEXT,
    personaplex_session_id TEXT,
    latency_first_ai_ms          INTEGER,
    latency_first_tool_result_ms INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pp_calls_call_sid ON pp_calls (call_sid);
CREATE INDEX idx_pp_calls_status ON pp_calls (status);
CREATE INDEX idx_pp_calls_created_at ON pp_calls (created_at);

-- ── pp_transcript_events ─────────────────────────────────────────────────────

CREATE TABLE pp_transcript_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id     UUID NOT NULL REFERENCES pp_calls (id) ON DELETE CASCADE,
    speaker     TEXT NOT NULL CHECK (speaker IN ('user', 'agent', 'system')),
    text        TEXT NOT NULL,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER,
    is_partial  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pp_transcript_events_call_id ON pp_transcript_events (call_id);
CREATE INDEX idx_pp_transcript_events_created_at ON pp_transcript_events (created_at);

-- ── pp_tool_events ───────────────────────────────────────────────────────────

CREATE TABLE pp_tool_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id       UUID NOT NULL REFERENCES pp_calls (id) ON DELETE CASCADE,
    tool_name     TEXT NOT NULL,
    direction     TEXT NOT NULL CHECK (direction IN ('request', 'response')),
    payload_json  JSONB,
    status        TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error', 'timeout')),
    latency_ms    INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pp_tool_events_call_id ON pp_tool_events (call_id);
CREATE INDEX idx_pp_tool_events_tool_name ON pp_tool_events (tool_name);
CREATE INDEX idx_pp_tool_events_created_at ON pp_tool_events (created_at);

-- ── pp_postcall_reports ──────────────────────────────────────────────────────

CREATE TABLE pp_postcall_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id             UUID NOT NULL REFERENCES pp_calls (id) ON DELETE CASCADE,
    summary             TEXT NOT NULL,
    intent              TEXT NOT NULL,
    outcome             TEXT NOT NULL,
    follow_up_required  BOOLEAN NOT NULL DEFAULT false,
    follow_up_at        TIMESTAMPTZ,
    crm_note            TEXT NOT NULL DEFAULT '',
    qa_flags_json       JSONB,
    sentiment           TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pp_postcall_reports_call_id ON pp_postcall_reports (call_id);
CREATE INDEX idx_pp_postcall_reports_created_at ON pp_postcall_reports (created_at);
CREATE INDEX idx_pp_postcall_reports_sentiment ON pp_postcall_reports (sentiment);
