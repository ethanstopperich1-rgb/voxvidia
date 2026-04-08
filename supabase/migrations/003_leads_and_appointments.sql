-- Leads and Appointments tables for VIP Buyback tools
-- Required by: get_buyback_lead_context, update_lead_status, book_appraisal_appointment,
--              save_callback_number, transfer_to_vip_desk, log_call_outcome

-- ── Leads ──────────────────────────────────────────────────────────────────
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  vehicle TEXT,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_trim TEXT,
  mailer_campaign TEXT,
  mailer_code TEXT,
  source TEXT NOT NULL DEFAULT 'mailer',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'contacted', 'interested', 'not_interested', 'appointment_booked',
    'no_longer_has_vehicle', 'wrong_person', 'callback_requested', 'closed'
  )),
  still_owns_vehicle BOOLEAN,
  interest_level TEXT CHECK (interest_level IN (
    'interested', 'curious', 'not_interested', 'wrong_person', 'unknown'
  )),
  vehicle_disposition TEXT CHECK (vehicle_disposition IN (
    'still_has_vehicle', 'sold_vehicle', 'traded_vehicle', 'unsure'
  )),
  callback_phone TEXT,
  notes TEXT,
  last_call_sid TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_dealer_status ON leads(dealer_id, status);
CREATE INDEX idx_leads_mailer_code ON leads(mailer_code) WHERE mailer_code IS NOT NULL;
CREATE INDEX idx_leads_dealer_created ON leads(dealer_id, created_at DESC);

-- ── Appointments ───────────────────────────────────────────────────────────
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  lead_id UUID NOT NULL REFERENCES leads(id),
  call_sid TEXT,
  confirmation_code TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  appointment_type TEXT NOT NULL DEFAULT 'vip_buyback_appraisal',
  callback_phone TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN (
    'confirmed', 'cancelled', 'completed', 'no_show'
  )),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_lead ON appointments(lead_id);
CREATE INDEX idx_appointments_date ON appointments(dealer_id, appointment_date, appointment_time);
CREATE INDEX idx_appointments_confirmation ON appointments(confirmation_code);

-- ── Transfer Log ───────────────────────────────────────────────────────────
CREATE TABLE transfer_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dealer_id UUID NOT NULL REFERENCES dealers(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  lead_id UUID,
  call_sid TEXT,
  transfer_reason TEXT NOT NULL,
  vip_desk_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON leads FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON appointments FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_full_access" ON transfer_log FOR ALL TO service_role USING (true);

CREATE POLICY "dealer_isolation" ON leads FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);
CREATE POLICY "dealer_isolation" ON appointments FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);
CREATE POLICY "dealer_isolation" ON transfer_log FOR SELECT TO authenticated
  USING (dealer_id = (auth.jwt() -> 'app_metadata' ->> 'dealer_id')::UUID);

-- ── Realtime ───────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
