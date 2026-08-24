-- =============================================
-- Sync repo with production drift (Aug 2026)
-- =============================================
-- 001_full_schema.sql was applied by hand in the SQL Editor and everything
-- below was added the same way afterwards, so the CLI's migration history
-- never recorded any of it. This migration brings the repo back in line
-- with what is actually running on the linked "CSxProduct" project, as
-- verified via `supabase db query --linked` against information_schema /
-- pg_catalog on 2026-08-24. All statements are idempotent so this is safe
-- to run against an environment that already has the drift (prod) or one
-- that only has 001 (a fresh env / staging).
-- =============================================

-- ===== ENUM ADDITIONS =====
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PRODUCT_TEAM';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ADMIN';

ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'RETURNED_TO_CS';

-- ===== TICKETS: ASSIGNEE + JIRA SYNC COLUMNS =====
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES app_users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS latest_comment TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS jira_status TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_jira_status_change_at TIMESTAMPTZ;

-- ===== RLS POLICY DRIFT =====
-- These two statements make the repo match what's *actually enforced* in
-- prod right now. Neither matches the app's intended access model:
--   * "Authenticated users can create tickets" (WITH CHECK true) sits
--     alongside the original "CS roles can create tickets" restriction.
--     Postgres OR's permissive policies together, so this one makes the
--     role check on ticket creation a no-op today.
--   * "Leads can update tickets" allows CS_MANAGER but not PRODUCT_TEAM
--     or ADMIN, while src/lib/stateMachine.ts's ALL_ACTION_ROLES is
--     CS_LEAD/PRODUCT_LEAD/PRODUCT_TEAM/ADMIN — so PRODUCT_TEAM and ADMIN
--     users currently can't update a ticket they didn't create.
-- Left as-is intentionally (mirroring prod, not fixing it) — flagged for
-- a follow-up decision rather than silently changing access control here.

DROP POLICY IF EXISTS "Authenticated users can create tickets" ON tickets;
CREATE POLICY "Authenticated users can create tickets"
  ON tickets FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Leads can update tickets" ON tickets;
CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'CS_MANAGER')
    )
    OR
    reporter_id = auth.uid()
  );

DROP POLICY IF EXISTS "Authorized users can create logs" ON update_logs;
CREATE POLICY "Authorized users can create logs"
  ON update_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
      AND role IN ('CS_MANAGER', 'CS_LEAD', 'PRODUCT_LEAD', 'PRODUCT_TEAM', 'ADMIN')
    )
  );
