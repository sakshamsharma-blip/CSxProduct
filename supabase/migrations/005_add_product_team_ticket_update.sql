-- =============================================
-- Add PRODUCT_TEAM to the ticket-update policy
-- =============================================
-- PRODUCT_TEAM is one of the ALL_ACTION_ROLES the app already treats as
-- able to change ticket status, sprint status, and progress (see
-- stateMachine.ts), but the RLS policy never included it — only CS_LEAD,
-- PRODUCT_LEAD, CS_MANAGER, and (as of migration 004) ADMIN. Without this,
-- a Product Team member could not actually update a ticket they didn't
-- personally create, e.g. via the new single-stage-picker action.
-- =============================================

DROP POLICY IF EXISTS "Leads can update tickets" ON tickets;
CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = get_person_id(auth.uid())
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'CS_MANAGER', 'PRODUCT_TEAM', 'ADMIN')
    )
    OR
    reporter_id = get_person_id(auth.uid())
  );
