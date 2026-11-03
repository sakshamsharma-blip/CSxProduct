-- =============================================
-- "Returned from hold" stays visible until someone decides on the ticket
-- =============================================
-- Before: the web browser moved expired holds back to Pending Product Review
-- when someone opened Flow, and only that person saw the banner, until they
-- reloaded. A CS Manager opening Flow couldn't even make the move (RLS).
--
-- Now:
--   * the database moves expired holds itself every 15 minutes (pg_cron),
--   * the ticket keeps a `returned_from_hold_at` mark,
--   * the mark is cleared automatically the next time the ticket's stage
--     changes (that is the decision on it),
--   * everyone sees the banner while any marked ticket remains.
-- =============================================

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS returned_from_hold_at timestamptz;

-- Set / clear the mark on every stage change:
--   * On Hold → Pending Product Review after the hold date passed: set it
--     (works whether the database job or an older web app made the move),
--   * any other stage change: clear it (that is the decision).
CREATE OR REPLACE FUNCTION tickets_clear_hold_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'ON_HOLD_UNTIL' AND NEW.status = 'PENDING_PROD_REVIEW'
       AND OLD.hold_until_date IS NOT NULL AND OLD.hold_until_date <= now() THEN
      NEW.returned_from_hold_at := now();
    ELSE
      NEW.returned_from_hold_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tickets_clear_hold_return ON tickets;
CREATE TRIGGER tickets_clear_hold_return
  BEFORE UPDATE OF status ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_clear_hold_return();

-- Move expired holds back to review and log it (same wording as before).
CREATE OR REPLACE FUNCTION public.release_expired_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  WITH moved AS (
    UPDATE public.tickets
    SET status = 'PENDING_PROD_REVIEW',
        hold_until_date = NULL          -- the trigger sets returned_from_hold_at
    WHERE status = 'ON_HOLD_UNTIL'
      AND hold_until_date IS NOT NULL
      AND hold_until_date <= now()
    RETURNING id, reporter_id
  ), logged AS (
    INSERT INTO public.update_logs (ticket_id, author_id, comment, previous_status, new_status, hold_target_date)
    SELECT id, reporter_id, 'Hold period expired — automatically moved back to review.',
           'ON_HOLD_UNTIL', 'PENDING_PROD_REVIEW', NULL
    FROM moved
    RETURNING 1
  )
  SELECT count(*) INTO n FROM logged;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.release_expired_holds() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('flow-release-holds') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-release-holds');
SELECT cron.schedule('flow-release-holds', '*/15 * * * *', $cron$ SELECT public.release_expired_holds(); $cron$);

-- Mark tickets that already came back from hold and haven't changed stage since.
WITH last_change AS (
  SELECT DISTINCT ON (l.ticket_id) l.ticket_id, l.previous_status, l.new_status, l.created_at
  FROM update_logs l
  WHERE l.previous_status <> l.new_status
  ORDER BY l.ticket_id, l.created_at DESC
)
UPDATE tickets t
SET returned_from_hold_at = lc.created_at
FROM last_change lc
WHERE lc.ticket_id = t.id
  AND t.status = 'PENDING_PROD_REVIEW'
  AND lc.previous_status = 'ON_HOLD_UNTIL'
  AND lc.new_status = 'PENDING_PROD_REVIEW'
  AND t.returned_from_hold_at IS NULL;
