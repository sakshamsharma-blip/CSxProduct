-- =============================================
-- IETT Database Schema
-- Internal Escalation Tracking Tool
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
  'RESOLVED'
);
CREATE TYPE ticket_sub_type AS ENUM ('BUG', 'ENHANCEMENT', 'FEATURE_REQUEST', 'BACKEND_CONFIG');
CREATE TYPE ticket_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- ===== SEQUENCE for human-readable ticket IDs =====
CREATE SEQUENCE ticket_id_seq START WITH 1001;

-- ===== USERS TABLE =====
-- Links to Supabase Auth via auth.users.id
CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'CS_MANAGER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== TICKETS TABLE =====
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  custom_id TEXT NOT NULL UNIQUE DEFAULT ('REQ-' || nextval('ticket_id_seq')::TEXT),
  lab_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sub_type ticket_sub_type NOT NULL DEFAULT 'BUG',
  priority ticket_priority NOT NULL DEFAULT 'MEDIUM',
  status ticket_status NOT NULL DEFAULT 'NEW_ESCALATION',
  freshdesk_id TEXT,
  hold_until_date TIMESTAMPTZ,
  last_product_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reporter_id UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_reporter ON tickets(reporter_id);
CREATE INDEX idx_tickets_custom_id ON tickets(custom_id);

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

-- ===== ROW LEVEL SECURITY =====

-- Enable RLS on all tables
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_logs ENABLE ROW LEVEL SECURITY;

-- app_users: All authenticated users can read all users
CREATE POLICY "Users can view all users"
  ON app_users FOR SELECT
  TO authenticated
  USING (true);

-- app_users: Users can only update their own profile
CREATE POLICY "Users can update own profile"
  ON app_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- tickets: All authenticated users can read all tickets
CREATE POLICY "All users can view tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (true);

-- tickets: CS_MANAGER and CS_LEAD can create tickets
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

-- tickets: CS_LEAD and PRODUCT_LEAD can update tickets
CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD')
    )
  );

-- update_logs: All authenticated users can read logs
CREATE POLICY "All users can view logs"
  ON update_logs FOR SELECT
  TO authenticated
  USING (true);

-- update_logs: CS_LEAD and PRODUCT_LEAD can insert logs
CREATE POLICY "Leads can create logs"
  ON update_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD')
    )
  );

-- update_logs: Nobody can update or delete logs (immutable)
-- No UPDATE or DELETE policies = denied by default with RLS enabled
