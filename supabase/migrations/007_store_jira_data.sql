-- =============================================
-- Store Jira data in Flow + background sync (plan items 10 and 12)
-- =============================================
-- Until now the web app asked Jira about every linked ticket on every page
-- load (one call per ticket). From here on:
--   * each ticket keeps its own copy of the Jira data (columns below),
--   * the web app and the MCP only read these columns,
--   * the `jira-sync-all` Edge Function refreshes them every 15 minutes
--     (pg_cron, scheduled at the bottom of this file).
--
-- The Jira link itself stays in `freshdesk_id` so nothing that already uses
-- it breaks; `jira_key` is derived from it automatically by a trigger.
-- =============================================

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS jira_key text,              -- e.g. EN-13736, always taken from freshdesk_id
  ADD COLUMN IF NOT EXISTS jira_issue_id text,         -- Jira's numeric id; stays the same when a ticket moves boards
  ADD COLUMN IF NOT EXISTS jira_status_category text,  -- To Do / In Progress / Done (same on every board)
  ADD COLUMN IF NOT EXISTS jira_assignee text,         -- display name of the Jira assignee
  ADD COLUMN IF NOT EXISTS jira_synced_at timestamptz; -- last time the background sync read this ticket from Jira

CREATE INDEX IF NOT EXISTS tickets_jira_key_idx ON tickets (jira_key);

-- ===== Keep jira_key in step with the link =====
-- Same pattern as extractJiraKey() in the app: first "ABC-123" in the link.
CREATE OR REPLACE FUNCTION tickets_sync_jira_key()
RETURNS TRIGGER AS $$
DECLARE
  new_key text := upper(substring(coalesce(NEW.freshdesk_id, '') from '([A-Za-z][A-Za-z0-9]+-[0-9]+)'));
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.jira_key := new_key;
  ELSIF NEW.freshdesk_id IS DISTINCT FROM OLD.freshdesk_id THEN
    NEW.jira_key := new_key;
    -- A different Jira ticket was linked: the stored Jira data belonged to the old one.
    IF new_key IS DISTINCT FROM OLD.jira_key THEN
      NEW.jira_issue_id := NULL;
      NEW.jira_status_category := NULL;
      NEW.jira_assignee := NULL;
      NEW.jira_synced_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_sync_jira_key ON tickets;
CREATE TRIGGER tickets_sync_jira_key
  BEFORE INSERT OR UPDATE OF freshdesk_id ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_sync_jira_key();

-- ===== Don't bump "Updated" for background bookkeeping =====
-- The sync touches every open ticket every 15 minutes. If only the
-- bookkeeping columns changed, keep updated_at as it was, so the "Updated"
-- column and sort still mean "a person or a real Jira change touched this".
CREATE OR REPLACE FUNCTION tickets_set_updated_at()
RETURNS TRIGGER AS $$
DECLARE
  bookkeeping text[] := ARRAY['updated_at', 'jira_key', 'jira_issue_id', 'jira_status_category', 'jira_assignee', 'jira_synced_at'];
BEGIN
  IF (to_jsonb(NEW) - bookkeeping) = (to_jsonb(OLD) - bookkeeping) THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON tickets;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_set_updated_at();

-- ===== Backfill jira_key for existing tickets (doesn't change updated_at) =====
UPDATE tickets
SET jira_key = upper(substring(coalesce(freshdesk_id, '') from '([A-Za-z][A-Za-z0-9]+-[0-9]+)'))
WHERE jira_key IS DISTINCT FROM upper(substring(coalesce(freshdesk_id, '') from '([A-Za-z][A-Za-z0-9]+-[0-9]+)'));

-- ===== Schedule the background sync every 15 minutes =====
-- Needs a Vault secret named `flow_jira_sync_secret` holding the same value
-- as the Edge Function secret JIRA_SYNC_SECRET (create both before this runs:
--   select vault.create_secret('<value>', 'flow_jira_sync_secret');
--   supabase secrets set JIRA_SYNC_SECRET=<value>)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('flow-jira-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-jira-sync');
SELECT cron.schedule(
  'flow-jira-sync',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://wfhrsjgsbpmmtcmaywtx.supabase.co/functions/v1/jira-sync-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'flow_jira_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
