-- =============================================
-- Enforce role/transition business rules at the database level
-- =============================================
-- Two gaps closed here, both previously enforced only in the frontend
-- (stateMachine.ts / actions.ts), meaning a direct API call with a valid
-- session could bypass them entirely:
--
-- 1. app_users: a user could update their own row with no restriction on
--    which columns changed — including `role` — letting them grant
--    themselves CS_LEAD/PRODUCT_LEAD/PRODUCT_TEAM permissions directly.
--    `primary_user_id` is locked the same way, since rewriting it would let
--    a secondary login remap itself onto a different (more privileged)
--    primary profile.
--
-- 2. tickets: the update policy only gated *whether* a role could touch a
--    ticket row, not *what* they could change it to. This mirrors the
--    actual UI rules:
--      - New Escalation is never a valid target for anyone.
--      - "Resolved by CS Lead" is only valid coming from New Escalation.
--      - Closing is the ticket's reporter's right alone and only once it's
--        actually resolved, except ADMIN (explicit operational override).
--      - CS_MANAGER may only ever move a ticket it reported to Closed —
--        no other role/stage combination.
--    Edits that don't change `status` (priority, assignee, sprint, etc.)
--    are unaffected by any of this.
--
-- Note: the correlated "old value" subqueries below explicitly qualify the
-- outer reference as `<table>.id` rather than a bare `id` — an aliased
-- self-join (e.g. `t_old`) still resolves an unqualified `id` to the alias
-- itself, not the outer row, which silently turns the correlation into
-- "id = id" (always true) and breaks the whole check.
-- =============================================

-- ===== APP_USERS: LOCK ROLE + PRIMARY_USER_ID ON SELF-UPDATE =====
DROP POLICY IF EXISTS "Users can update own profile" ON app_users;
CREATE POLICY "Users can update own profile"
  ON app_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT u_old.role FROM app_users u_old WHERE u_old.id = app_users.id)
    AND primary_user_id IS NOT DISTINCT FROM (SELECT u_old.primary_user_id FROM app_users u_old WHERE u_old.id = app_users.id)
  );

-- ===== TICKETS: MIRROR STATUS-TRANSITION RULES =====
DROP POLICY IF EXISTS "Leads can update tickets" ON tickets;
CREATE POLICY "Leads can update tickets"
  ON tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE id = get_person_id(auth.uid())
      AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'PRODUCT_TEAM', 'ADMIN')
    )
    OR reporter_id = get_person_id(auth.uid())
  )
  WITH CHECK (
    -- Status unchanged (e.g. only priority/assignee/sprint edited): no
    -- extra restriction beyond the row-level check above.
    status = (SELECT t_old.status FROM tickets t_old WHERE t_old.id = tickets.id)
    OR (
      -- Status is actually changing: apply the workflow rules.
      status != 'NEW_ESCALATION'
      AND (
        status != 'RESOLVED_BY_CS'
        OR (SELECT t_old.status FROM tickets t_old WHERE t_old.id = tickets.id) = 'NEW_ESCALATION'
      )
      AND (
        status != 'CLOSED'
        OR EXISTS (SELECT 1 FROM app_users WHERE id = get_person_id(auth.uid()) AND role = 'ADMIN')
        OR (
          reporter_id = get_person_id(auth.uid())
          AND (SELECT t_old.status FROM tickets t_old WHERE t_old.id = tickets.id) IN ('RESOLVED', 'RESOLVED_BY_CS')
        )
      )
      AND (
        -- CS_MANAGER (or any role without a lead/product/admin seat) may
        -- only ever move its own ticket to Closed — nothing else.
        EXISTS (SELECT 1 FROM app_users WHERE id = get_person_id(auth.uid()) AND role IN ('CS_LEAD', 'PRODUCT_LEAD', 'PRODUCT_TEAM', 'ADMIN'))
        OR (status = 'CLOSED' AND reporter_id = get_person_id(auth.uid()))
      )
    )
  );
