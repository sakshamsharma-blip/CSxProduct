-- =============================================
-- Tighten ticket-insert RLS + give ADMIN full override
-- =============================================
-- 1. Removes the leftover permissive insert policy that let any
--    authenticated user create tickets regardless of role. Ticket
--    creation now goes through "CS roles can create tickets" only,
--    which already matches the UI's own role gate (CS_MANAGER, CS_LEAD,
--    ADMIN).
-- 2. Adds ADMIN to the ticket-update policy's role list, so the admin
--    account can update/close/reopen any ticket, not only ones it
--    personally created (matching the app-layer state machine, which
--    already lets ADMIN bypass every role/creator check).
-- =============================================

DROP POLICY IF EXISTS "Authenticated users can create tickets" ON tickets;

DROP POLICY IF EXISTS "Leads can update tickets" ON tickets;
CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = get_person_id(auth.uid())
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'CS_MANAGER', 'ADMIN')
    )
    OR
    reporter_id = get_person_id(auth.uid())
  );
