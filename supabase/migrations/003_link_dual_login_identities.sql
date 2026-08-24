-- =============================================
-- Link secondary-domain logins to their primary profile
-- =============================================
-- Root cause: invite-user creates two Supabase Auth accounts per person
-- (one per email domain). The signup trigger that's supposed to create a
-- matching app_users profile for each has been silently failing for every
-- secondary-domain account (16/16 checked on 2026-08-24) — see the
-- exception-swallowing handler in handle_new_user(). With no profile row,
-- role/ownership checks fail for that login, blocking ticket creation and
-- status transitions (including "close ticket") for anyone signed in via
-- their secondary email.
--
-- This migration is purely additive: a new nullable column, a new helper
-- function, new profile rows for the accounts that were missing one, and
-- corrected policy logic. No existing row in app_users, tickets, or
-- update_logs is modified or deleted, and no account/password is touched.
-- =============================================

-- ===== LINK COLUMN =====
-- NULL for a normal/primary profile. Set to the primary profile's id for a
-- secondary-domain profile, so both logins can be resolved to one person.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS primary_user_id UUID REFERENCES app_users(id);

-- ===== IDENTITY RESOLUTION HELPER =====
-- Given an auth uid, returns the canonical "person" id: the linked primary
-- id if this is a secondary login, otherwise the uid itself.
CREATE OR REPLACE FUNCTION get_person_id(uid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT primary_user_id FROM app_users WHERE id = uid AND primary_user_id IS NOT NULL),
    uid
  );
$$;

-- ===== BACKFILL MISSING SECONDARY PROFILES =====
-- Matches each orphaned secondary auth account (no app_users row) to its
-- primary profile via the existing secondary_email field, and creates the
-- missing linked row. Additive only — an existing profile is never
-- overwritten (WHERE existing.id IS NULL guards this).
INSERT INTO app_users (id, full_name, email, role, primary_user_id)
SELECT u.id, au.full_name, u.email, au.role, au.id
FROM auth.users u
JOIN app_users au ON lower(au.secondary_email) = lower(u.email)
LEFT JOIN app_users existing ON existing.id = u.id
WHERE existing.id IS NULL;

-- ===== ROUTE ROLE/OWNERSHIP CHECKS THROUGH get_person_id =====
-- Same policies as before, just resolving the acting identity through
-- get_person_id() so a secondary login is treated as its linked primary.
DROP POLICY IF EXISTS "CS roles can create tickets" ON tickets;
CREATE POLICY "CS roles can create tickets"
  ON tickets FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = get_person_id(auth.uid())
      AND role IN ('CS_MANAGER', 'CS_LEAD', 'ADMIN')
    )
  );

DROP POLICY IF EXISTS "Leads can update tickets" ON tickets;
CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = get_person_id(auth.uid())
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'CS_MANAGER')
    )
    OR
    reporter_id = get_person_id(auth.uid())
  );

DROP POLICY IF EXISTS "Authorized users can create logs" ON update_logs;
CREATE POLICY "Authorized users can create logs"
  ON update_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = get_person_id(auth.uid())
      AND role IN ('CS_MANAGER', 'CS_LEAD', 'PRODUCT_LEAD', 'PRODUCT_TEAM', 'ADMIN')
    )
  );
