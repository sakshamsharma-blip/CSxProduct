-- =============================================
-- IETT - Complete Database Schema (Final)
-- Internal Escalation Tracking Tool
-- =============================================
-- INSTRUCTIONS:
-- 1. First run the NUKE query (see supabase/RESET.sql) to wipe old schema
-- 2. Then run this file in Supabase SQL Editor
-- =============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== ENUMS =====
CREATE TYPE user_role AS ENUM ('CS_MANAGER', 'CS_LEAD', 'PRODUCT_LEAD');

CREATE TYPE ticket_status AS ENUM (
  'NEW_ESCALATION',
  'RESOLVED_BY_CS',
  'PENDING_PROD_REVIEW',
  'IN_PRODUCT_SCOPE',
  'ON_HOLD_UNTIL',
  'RESOLVED',
  'CLOSED'
);

CREATE TYPE ticket_sub_type AS ENUM ('BUG', 'ENHANCEMENT', 'FEATURE_REQUEST', 'BACKEND_CONFIG');

CREATE TYPE ticket_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE sprint_status AS ENUM ('IN_SPRINT', 'NEXT_SPRINT', 'AWAITED');

-- ===== SEQUENCE for human-readable ticket IDs =====
CREATE SEQUENCE ticket_id_seq START WITH 1001;

-- ===== USERS TABLE =====
CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  secondary_email TEXT UNIQUE,
  role user_role NOT NULL DEFAULT 'CS_MANAGER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== TICKETS TABLE =====
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  custom_id TEXT NOT NULL UNIQUE DEFAULT ('REQ-' || nextval('ticket_id_seq')::TEXT),
  lab_name TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sub_type ticket_sub_type NOT NULL DEFAULT 'BUG',
  priority ticket_priority NOT NULL DEFAULT 'MEDIUM',
  status ticket_status NOT NULL DEFAULT 'NEW_ESCALATION',
  sprint_status sprint_status DEFAULT NULL,
  freshdesk_id TEXT,
  hold_until_date TIMESTAMPTZ,
  last_product_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_reopened BOOLEAN NOT NULL DEFAULT FALSE,
  reopen_count INTEGER NOT NULL DEFAULT 0,
  sla_breach_count INTEGER NOT NULL DEFAULT 0,
  reporter_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_reporter ON tickets(reporter_id);
CREATE INDEX idx_tickets_custom_id ON tickets(custom_id);
CREATE INDEX idx_tickets_client_id ON tickets(client_id);
CREATE INDEX idx_tickets_lab_name ON tickets(lab_name);

-- ===== UPDATE LOGS TABLE (Immutable Audit Trail) =====
CREATE TABLE update_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES app_users(id),
  comment TEXT NOT NULL DEFAULT '',
  previous_status ticket_status NOT NULL,
  new_status ticket_status NOT NULL,
  hold_target_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_update_logs_ticket ON update_logs(ticket_id);
CREATE INDEX idx_update_logs_created ON update_logs(created_at);

-- ===== AUTO-UPDATE updated_at TRIGGER =====
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===== AUTO-CREATE app_users ON SIGNUP =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.app_users (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    CASE 
      WHEN NEW.raw_user_meta_data->>'role' IN ('CS_MANAGER', 'CS_LEAD', 'PRODUCT_LEAD')
      THEN (NEW.raw_user_meta_data->>'role')::user_role
      ELSE 'CS_MANAGER'::user_role
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== ROW LEVEL SECURITY =====

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_logs ENABLE ROW LEVEL SECURITY;

-- app_users policies
CREATE POLICY "Users can view all users"
  ON app_users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON app_users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON app_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- tickets policies
CREATE POLICY "All users can view tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "CS roles can create tickets"
  ON tickets FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_MANAGER', 'CS_LEAD')
    )
  );

CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'ADMIN')
    )
    OR
    -- Creator can update (for close/reopen)
    reporter_id = auth.uid()
  );

-- update_logs policies
CREATE POLICY "All users can view logs"
  ON update_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authorized users can create logs"
  ON update_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_MANAGER', 'CS_LEAD', 'PRODUCT_LEAD')
    )
  );

-- update_logs: No UPDATE or DELETE policies = immutable by default with RLS
