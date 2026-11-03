// Data access for the Flow MCP server.
// Every query runs with the *caller's own* token, so Postgres RLS applies
// exactly as it does in the web app.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  isTicketVisible, extractJiraKey, displayId, isJiraKey, needsWeeklyUpdate, isHoldExpired, lastActivityAt, daysBetween,
  STATUS_LABELS, SUB_TYPE_LABELS, SPRINT_STATUS_LABELS, ROLE_LABELS, PRODUCT_ROLES,
  TicketStatus, TicketSubType, SprintStatus, UserRole, Priority,
} from '../_shared/flowRules.ts';

export interface Me {
  id: string;          // canonical (primary) profile id — what the app uses for ownership
  authId: string;      // the auth account actually signed in (may be a secondary-domain login)
  full_name: string;
  email: string;
  role: UserRole;
}

export interface Ctx {
  db: SupabaseClient;
  me: Me;
}

export interface PersonRef { id: string; full_name: string; email: string }

export interface TicketRow {
  id: string;
  custom_id: string;
  lab_name: string;
  client_id: string;
  subject: string;
  description: string;
  sub_type: TicketSubType;
  priority: Priority;
  status: TicketStatus;
  sprint_status: SprintStatus | null;
  freshdesk_id: string | null;
  hold_until_date: string | null;
  last_product_activity_at: string;
  is_reopened: boolean;
  reopen_count: number;
  sla_breach_count: number;
  reporter_id: string;
  assignee_id: string | null;
  latest_comment: string | null;
  jira_status: string | null;
  last_jira_status_change_at: string | null;
  jira_assignee: string | null;
  jira_synced_at: string | null;
  created_at: string;
  updated_at: string;
  reporter: PersonRef | null;
  assignee: PersonRef | null;
}

export interface LogRow {
  id: string;
  ticket_id: string;
  author_id: string;
  comment: string;
  previous_status: TicketStatus;
  new_status: TicketStatus;
  hold_target_date: string | null;
  created_at: string;
  author?: { full_name: string; role: UserRole } | null;
}

export const TICKET_SELECT =
  'id, custom_id, lab_name, client_id, subject, description, sub_type, priority, status, sprint_status, ' +
  'freshdesk_id, hold_until_date, last_product_activity_at, is_reopened, reopen_count, sla_breach_count, ' +
  'reporter_id, assignee_id, latest_comment, jira_status, last_jira_status_change_at, jira_assignee, jira_synced_at, created_at, updated_at, ' +
  'reporter:app_users!reporter_id(id, full_name, email), assignee:app_users!assignee_id(id, full_name, email)';

/** A tool-level failure whose message is safe and useful to show the user. */
export class UserFacingError extends Error {}

// deno-lint-ignore no-explicit-any
export function dbError(error: any, action: string): UserFacingError {
  const code = error?.code as string | undefined;
  if (code === '42501') {
    return new UserFacingError(`The database refused to ${action} — your role isn't allowed to do this.`);
  }
  return new UserFacingError(`Could not ${action}: ${error?.message ?? 'unknown database error'}`);
}

/**
 * PostgREST caps a single response (1000 rows by default), so page through
 * everything. The builder factory is re-created per page.
 */
// deno-lint-ignore no-explicit-any
export async function fetchAll<T>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw dbError(error, 'load data');
    out.push(...(data as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function loadAllTickets(db: SupabaseClient): Promise<TicketRow[]> {
  return fetchAll<TicketRow>(() =>
    db.from('tickets').select(TICKET_SELECT).order('created_at', { ascending: false }).order('id')
  );
}

export async function loadVisibleTickets(ctx: Ctx): Promise<TicketRow[]> {
  const all = await loadAllTickets(ctx.db);
  return all.filter(t => isTicketVisible(t, ctx.me.role, ctx.me.id));
}

/** Accepts "REQ-1042", "req 1042", "1042". */
export function normalizeTicketRef(ref: string): string {
  const digits = ref.trim().match(/^(?:REQ[-\s_]?)?(\d+)$/i);
  if (!digits) throw new UserFacingError(`"${ref}" doesn't look like a ticket ID (expected a Jira key like EN-1234, or a Flow ID like REQ-1042).`);
  return `REQ-${digits[1]}`;
}

/**
 * Finds a ticket by its Jira key (EA-1234, EN-567…) or its Flow ID (REQ-1042 / 1042).
 * People mostly know tickets by their Jira key, so that is tried first.
 */
export async function findTicket(ctx: Ctx, ref: string): Promise<TicketRow> {
  const raw = ref.trim();
  if (isJiraKey(raw)) {
    const key = raw.toUpperCase();
    const { data, error } = await ctx.db.from('tickets').select(TICKET_SELECT).ilike('freshdesk_id', `%${key}%`);
    if (error) throw dbError(error, `load ${key}`);
    // ilike "EA-15" would also match "EA-150", so keep exact key matches only.
    const all = ((data ?? []) as unknown as TicketRow[])
      .filter(t => extractJiraKey(t.freshdesk_id) === key && isTicketVisible(t, ctx.me.role, ctx.me.id));
    // Closed tickets don't count as duplicates: prefer the open one(s).
    const open = all.filter(t => t.status !== TicketStatus.CLOSED);
    const matches = open.length > 0 ? open : all;
    if (matches.length === 0) {
      throw new UserFacingError(`No Flow ticket visible to a ${ROLE_LABELS[ctx.me.role]} is linked to ${key}.`);
    }
    if (matches.length > 1) {
      throw new UserFacingError(
        `${key} is linked to more than one open Flow ticket (${matches.map(t => `${t.custom_id}: ${STATUS_LABELS[t.status]}`).join(', ')}) — ` +
        `these look like duplicates. Use the Flow ID (e.g. ${matches[0].custom_id}) to pick one.`);
    }
    return matches[0];
  }
  const customId = normalizeTicketRef(raw);
  const { data, error } = await ctx.db.from('tickets').select(TICKET_SELECT).eq('custom_id', customId).maybeSingle();
  if (error) throw dbError(error, `load ${customId}`);
  const ticket = data as TicketRow | null;
  if (!ticket || !isTicketVisible(ticket, ctx.me.role, ctx.me.id)) {
    throw new UserFacingError(`${customId} wasn't found, or it isn't visible to a ${ROLE_LABELS[ctx.me.role]}.`);
  }
  return ticket;
}

/** Other open (not Closed) tickets already linked to the same Jira key, for duplicate warnings. */
export async function findTicketsByJiraKey(ctx: Ctx, key: string, excludeId?: string): Promise<TicketRow[]> {
  const k = key.toUpperCase();
  const { data, error } = await ctx.db.from('tickets').select(TICKET_SELECT).ilike('freshdesk_id', `%${k}%`)
    .neq('status', TicketStatus.CLOSED);
  if (error) throw dbError(error, `check for tickets linked to ${k}`);
  return ((data ?? []) as unknown as TicketRow[]).filter(t => extractJiraKey(t.freshdesk_id) === k && t.id !== excludeId);
}

/** Open tickets for the same client with the same subject (case/space-insensitive). */
export async function findSimilarTickets(ctx: Ctx, clientId: string, subject: string): Promise<TicketRow[]> {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  const { data, error } = await ctx.db.from('tickets').select(TICKET_SELECT)
    .ilike('client_id', clientId.trim()).neq('status', TicketStatus.CLOSED);
  if (error) throw dbError(error, 'check for similar tickets');
  return ((data ?? []) as unknown as TicketRow[]).filter(t => norm(t.subject) === norm(subject));
}

export async function loadTimeline(db: SupabaseClient, ticketId: string): Promise<LogRow[]> {
  return fetchAll<LogRow>(() =>
    db.from('update_logs')
      .select('id, ticket_id, author_id, comment, previous_status, new_status, hold_target_date, created_at, author:app_users!author_id(full_name, role)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .order('id')
  );
}

export interface ActivityRow extends LogRow {
  ticket: Pick<TicketRow, 'id' | 'custom_id' | 'freshdesk_id' | 'lab_name' | 'client_id' | 'subject' | 'status' | 'is_reopened' | 'reporter_id' | 'assignee_id'> | null;
}

/** Timeline entries across all tickets in [from, to], oldest first. */
export async function loadActivity(db: SupabaseClient, from: Date, to: Date): Promise<ActivityRow[]> {
  return fetchAll<ActivityRow>(() =>
    db.from('update_logs')
      .select('id, ticket_id, author_id, comment, previous_status, new_status, hold_target_date, created_at, ' +
        'author:app_users!author_id(full_name, role), ' +
        'ticket:tickets!ticket_id(id, custom_id, freshdesk_id, lab_name, client_id, subject, status, is_reopened, reporter_id, assignee_id)')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: true })
      .order('id')
  );
}

export async function loadProductUsers(db: SupabaseClient): Promise<{ id: string; full_name: string; email: string; role: UserRole }[]> {
  const { data, error } = await db
    .from('app_users')
    .select('id, full_name, email, role')
    .is('primary_user_id', null)
    .in('role', PRODUCT_ROLES)
    .order('full_name');
  if (error) throw dbError(error, 'load users');
  return data ?? [];
}

// ===== Presentation =====

export function stageLabel(t: Pick<TicketRow, 'status' | 'is_reopened'>): string {
  if (t.is_reopened && t.status === TicketStatus.NEW_ESCALATION) return 'Reopened';
  return STATUS_LABELS[t.status] ?? t.status;
}

function clip(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Compact one-row view used in lists. */
export function ticketSummary(t: TicketRow, now = new Date()) {
  const inProduct = t.status === TicketStatus.IN_PRODUCT_SCOPE || t.status === TicketStatus.IN_PROGRESS;
  return {
    // Jira key when linked (what people search for), else the Flow REQ ID.
    id: displayId(t),
    flow_id: t.custom_id,
    lab: t.lab_name,
    client_id: t.client_id || null,
    subject: t.subject,
    type: SUB_TYPE_LABELS[t.sub_type] ?? t.sub_type,
    priority: t.priority,
    stage: stageLabel(t),
    stage_code: t.status,
    sprint: t.sprint_status ? SPRINT_STATUS_LABELS[t.sprint_status] : null,
    assignee: t.assignee?.full_name ?? null,
    created_by: t.reporter?.full_name ?? null,
    jira: extractJiraKey(t.freshdesk_id),
    jira_status: t.jira_status,
    reopened: t.is_reopened || undefined,
    days_open: daysBetween(t.created_at, now),
    days_since_product_activity: inProduct ? daysBetween(lastActivityAt(t), now) : undefined,
    weekly_update_overdue: needsWeeklyUpdate(t, now) || undefined,
    on_hold_until: t.hold_until_date ? t.hold_until_date.slice(0, 10) : undefined,
    hold_expired: isHoldExpired(t, now) || undefined,
    latest_comment: clip(t.latest_comment, 200),
    updated_at: t.updated_at,
  };
}

/** Full view used by get_ticket. */
export function ticketDetail(t: TicketRow, now = new Date()) {
  return {
    ...ticketSummary(t, now),
    description: t.description || null,
    latest_comment: t.latest_comment,
    jira_link: t.freshdesk_id,
    jira_assignee: t.jira_assignee,
    jira_data_as_of: t.jira_synced_at,
    created_by_email: t.reporter?.email ?? null,
    assignee_email: t.assignee?.email ?? null,
    reopen_count: t.reopen_count,
    sla_breach_count: t.sla_breach_count,
    created_at: t.created_at,
  };
}

export function timelineEntry(l: LogRow) {
  const changed = l.previous_status !== l.new_status;
  const reopened = changed && l.new_status === TicketStatus.NEW_ESCALATION &&
    (l.previous_status === TicketStatus.RESOLVED || l.previous_status === TicketStatus.RESOLVED_BY_CS);
  return {
    at: l.created_at,
    by: l.author?.full_name ?? 'Unknown',
    by_role: l.author?.role ? ROLE_LABELS[l.author.role] : undefined,
    stage_change: changed
      ? `${STATUS_LABELS[l.previous_status]} → ${reopened ? 'Reopened' : STATUS_LABELS[l.new_status]}`
      : undefined,
    hold_until: l.hold_target_date ? l.hold_target_date.slice(0, 10) : undefined,
    comment: l.comment,
  };
}
