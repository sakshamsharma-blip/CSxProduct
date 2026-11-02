// Supabase Edge Function: jira-sync-all
//
// Refreshes the stored Jira data on Flow tickets (plan items 10 + 12).
// The web app and the MCP never call Jira themselves any more; they read the
// columns this function keeps up to date.
//
// Two ways to call it:
//   1. Every 15 minutes from pg_cron (migration 007) with the header
//      `x-sync-secret: <JIRA_SYNC_SECRET>` → syncs every open linked ticket.
//   2. From the web app by a signed-in Flow user with { "ticket_id": "<uuid>" }
//      → syncs just that ticket (used right after someone changes a Jira link).
//
// What a sync does per ticket:
//   * reads status, status category and assignee from Jira,
//   * if the Jira key changed (ticket moved boards, e.g. EA-1234 → EN-567),
//     updates the link and writes a timeline entry,
//   * if the status changed, stores it, stamps last_jira_status_change_at
//     (counts as activity for the 7-day rule) and writes a timeline entry.
//
// Jira calls: tickets we already know the Jira id of are fetched in batches
// of up to 100 with one search; the rest (first sync, newly linked) one by one.
//
// Secrets: JIRA_EMAIL, JIRA_API_TOKEN, JIRA_DOMAIN (shared with jira-sync),
//          JIRA_SYNC_SECRET (must match Vault secret flow_jira_sync_secret).
// Deploy:  supabase functions deploy jira-sync-all --no-verify-jwt
//          (the function checks the secret / user token itself)

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';

const JIRA_DOMAIN = Deno.env.get('JIRA_DOMAIN') ?? 'crelio.atlassian.net';
const JIRA_AUTH = 'Basic ' + btoa(`${Deno.env.get('JIRA_EMAIL') ?? ''}:${Deno.env.get('JIRA_API_TOKEN') ?? ''}`);
const SYNC_SECRET = Deno.env.get('JIRA_SYNC_SECRET') ?? '';
const FIELDS = ['status', 'assignee'];
const BATCH = 100;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    status?: { name?: string; statusCategory?: { name?: string } } | null;
    assignee?: { displayName?: string } | null;
  };
}

interface TicketRow {
  id: string;
  custom_id: string;
  status: string;
  reporter_id: string;
  freshdesk_id: string | null;
  jira_key: string | null;
  jira_issue_id: string | null;
  jira_status: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- Jira calls

async function jira(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3${path}`, {
      ...init,
      headers: { Authorization: JIRA_AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    if (res.status !== 429) return res;
    // Rate limited: wait as long as Jira asks (capped), then retry.
    const wait = Math.min(Number(res.headers.get('Retry-After') ?? '5') || 5, 30);
    await sleep(wait * 1000);
  }
  throw new Error('Jira kept rate-limiting the sync; will retry on the next run.');
}

/** One issue by key or id. null = it doesn't exist (or we can't see it). */
async function getIssue(keyOrId: string): Promise<JiraIssue | null> {
  const res = await jira(`/issue/${encodeURIComponent(keyOrId)}?fields=${FIELDS.join(',')}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Jira returned ${res.status} for ${keyOrId}`);
  return await res.json();
}

/** Many issues by Jira id in one search. null = Jira rejected the query (caller falls back to one by one). */
async function searchByIds(ids: string[]): Promise<JiraIssue[] | null> {
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const res = await jira('/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql: `id in (${ids.join(',')})`, fields: FIELDS, maxResults: BATCH, nextPageToken }),
    });
    if (res.status === 400) return null;
    if (!res.ok) throw new Error(`Jira search returned ${res.status}`);
    const data = await res.json();
    out.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken ?? undefined;
  } while (nextPageToken);
  return out;
}

/** Runs fn over items with at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// ---------------------------------------------------------------- Writing back

async function log(t: TicketRow, comment: string) {
  await db.from('update_logs').insert([{
    ticket_id: t.id,
    author_id: t.reporter_id, // system action, attributed to the reporter (as before)
    comment,
    previous_status: t.status,
    new_status: t.status,
    hold_target_date: null,
  }]);
}

interface Result { checked: number; status_changes: number; moved: number; not_found: string[]; errors: string[] }

async function apply(t: TicketRow, issue: JiraIssue | null, r: Result) {
  const now = new Date().toISOString();
  r.checked++;

  if (!issue) {
    r.not_found.push(`${t.custom_id} (${t.jira_key})`);
    await db.from('tickets').update({ jira_synced_at: now }).eq('id', t.id);
    return;
  }

  // Ticket moved to another board: point the link at the new key.
  // (The trigger clears the stored Jira data on a key change; it's written again just below.)
  const currentKey = issue.key.toUpperCase();
  if (t.jira_key && currentKey !== t.jira_key) {
    const { error } = await db.from('tickets')
      .update({ freshdesk_id: `https://${JIRA_DOMAIN}/browse/${currentKey}` })
      .eq('id', t.id);
    if (!error) {
      r.moved++;
      await log(t, `Jira ticket moved: ${t.jira_key} → ${currentKey} (link updated automatically)`);
    }
  }

  const update: Record<string, unknown> = {
    jira_issue_id: issue.id,
    jira_status_category: issue.fields.status?.statusCategory?.name ?? null,
    jira_assignee: issue.fields.assignee?.displayName ?? null,
    jira_synced_at: now,
  };
  const newStatus = issue.fields.status?.name ?? null;
  const statusChanged = !!newStatus && newStatus !== t.jira_status;
  if (statusChanged) {
    update.jira_status = newStatus;
    update.last_jira_status_change_at = now;
  }
  const { error } = await db.from('tickets').update(update).eq('id', t.id);
  if (error) {
    r.errors.push(`${t.custom_id}: ${error.message}`);
    return;
  }
  if (statusChanged) {
    r.status_changes++;
    await log(t, t.jira_status ? `JIRA status changed: ${t.jira_status} → ${newStatus}` : `JIRA status synced: ${newStatus}`);
  }
}

// ---------------------------------------------------------------- Main

async function sync(tickets: TicketRow[]): Promise<Result> {
  const r: Result = { checked: 0, status_changes: 0, moved: 0, not_found: [], errors: [] };
  const oneByOne: TicketRow[] = tickets.filter(t => !t.jira_issue_id);
  const known = tickets.filter(t => t.jira_issue_id);

  // Known Jira ids: one search per 100 tickets.
  for (let i = 0; i < known.length; i += BATCH) {
    const batch = known.slice(i, i + BATCH);
    const ids = [...new Set(batch.map(t => t.jira_issue_id!))];
    const issues = await searchByIds(ids);
    if (!issues) { oneByOne.push(...batch); continue; }
    const byId = new Map(issues.map(x => [x.id, x]));
    for (const t of batch) {
      const issue = byId.get(t.jira_issue_id!);
      if (issue) await apply(t, issue, r);
      else oneByOne.push(t); // not returned (deleted / no access): double-check by itself
    }
  }

  // First sync, newly linked, or not returned by the search: by key (Jira follows moved keys) or id.
  await pool(oneByOne, 5, async t => {
    try {
      const issue = await getIssue(t.jira_issue_id ?? t.jira_key!);
      await apply(t, issue, r);
    } catch (err) {
      r.errors.push(`${t.custom_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!Deno.env.get('JIRA_EMAIL') || !Deno.env.get('JIRA_API_TOKEN')) {
      return json({ error: 'Jira credentials not configured' }, 500);
    }

    const fromCron = SYNC_SECRET !== '' && req.headers.get('x-sync-secret') === SYNC_SECRET;
    let onlyTicketId: string | null = null;

    if (!fromCron) {
      // Otherwise: a signed-in Flow user refreshing one ticket.
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
      if (!data.user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json().catch(() => ({}));
      if (typeof body.ticket_id !== 'string' || !body.ticket_id) return json({ error: 'ticket_id is required' }, 400);
      onlyTicketId = body.ticket_id;
    }

    let q = db.from('tickets')
      .select('id, custom_id, status, reporter_id, freshdesk_id, jira_key, jira_issue_id, jira_status')
      .not('jira_key', 'is', null);
    q = onlyTicketId ? q.eq('id', onlyTicketId) : q.neq('status', 'CLOSED');
    const { data: tickets, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const result = await sync((tickets ?? []) as TicketRow[]);
    return json(result);
  } catch (err) {
    console.error('[jira-sync-all]', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
