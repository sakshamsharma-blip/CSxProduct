import { startOfDay, startOfWeek, subDays, endOfDay } from 'date-fns';
import { Ticket, UpdateLog, UserRole, TicketStatus, STATUS_LABELS } from '../types';
import { getVisibleTickets } from '../hooks/useTickets';

// ===== Recent Activity: one feed of timeline entries across tickets =====
// Same data as each ticket's Activity Timeline (update_logs), plus tickets
// created in the window (creation itself writes no log entry).
// The Flow MCP's `recent_activity` tool applies the same rules.

export type ActivityPeriod = 'today' | 'last_2_days' | 'this_week' | 'last_30_days' | 'custom';

export const ACTIVITY_PERIOD_LABELS: Record<ActivityPeriod, string> = {
  today: 'Today',
  last_2_days: 'Last 2 days',
  this_week: 'This week',
  last_30_days: 'Last 30 days',
  custom: 'Custom range',
};

export interface ActivityWindow { start: Date; end: Date }

export function getActivityWindow(period: ActivityPeriod, customStart?: string, customEnd?: string, now: Date = new Date()): ActivityWindow {
  switch (period) {
    case 'today':
      return { start: startOfDay(now), end: now };
    case 'last_2_days':
      return { start: subDays(now, 2), end: now };
    case 'this_week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: now };
    case 'last_30_days':
      return { start: subDays(now, 30), end: now };
    case 'custom':
      return {
        start: customStart ? startOfDay(new Date(`${customStart}T00:00:00`)) : subDays(now, 2),
        end: customEnd ? endOfDay(new Date(`${customEnd}T00:00:00`)) : now,
      };
  }
}

export type ActivityItem =
  | { kind: 'log'; at: string; log: UpdateLog; ticket: Ticket }
  | { kind: 'created'; at: string; ticket: Ticket };

export interface ActivityFilters {
  person: string | 'ALL';       // app_users id of the author/creator
  clientId: string;             // exact client ID, '' = any
  onlyStageChanges: boolean;
  onlyMyTickets: boolean;       // created by me or assigned to me
  search: string;               // ticket ID, lab, subject, comment
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = {
  person: 'ALL', clientId: '', onlyStageChanges: false, onlyMyTickets: false, search: '',
};

export interface ActivitySummary {
  updates: number;
  ticketsTouched: number;
  newTickets: number;
  stageChanges: number;
  movedTo: { label: string; count: number }[];
}

export function isStageChange(log: Pick<UpdateLog, 'previous_status' | 'new_status'>): boolean {
  return log.previous_status !== log.new_status;
}

/**
 * Builds the feed, newest first. `logs` = entries already limited to the
 * window; `tickets` = all tickets (role visibility is applied here, the same
 * way the dashboard does it).
 */
export function buildActivityFeed(
  logs: UpdateLog[],
  tickets: Ticket[],
  window: ActivityWindow,
  role: UserRole,
  userId: string,
  filters: ActivityFilters,
): { items: ActivityItem[]; summary: ActivitySummary } {
  const visible = new Map(getVisibleTickets(tickets, role, userId).map(t => [t.id, t]));
  const q = filters.search.trim().toLowerCase();
  const client = filters.clientId.trim().toLowerCase();

  const ticketOk = (t: Ticket) =>
    (!filters.onlyMyTickets || t.reporter_id === userId || t.assignee_id === userId) &&
    (!client || t.client_id.trim().toLowerCase() === client);
  const textOk = (t: Ticket, comment?: string) =>
    !q || [t.custom_id, t.lab_name, t.subject, t.client_id, comment].some(v => v?.toLowerCase().includes(q));

  const items: ActivityItem[] = [];
  for (const log of logs) {
    const t = visible.get(log.ticket_id);
    if (!t || !ticketOk(t) || !textOk(t, log.comment)) continue;
    if (filters.onlyStageChanges && !isStageChange(log)) continue;
    if (filters.person !== 'ALL' && log.author_id !== filters.person) continue;
    items.push({ kind: 'log', at: log.created_at, log, ticket: t });
  }
  const startMs = window.start.getTime(), endMs = window.end.getTime();
  if (!filters.onlyStageChanges) {
    for (const t of visible.values()) {
      const c = new Date(t.created_at).getTime();
      if (c < startMs || c > endMs || !ticketOk(t) || !textOk(t)) continue;
      if (filters.person !== 'ALL' && t.reporter_id !== filters.person) continue;
      items.push({ kind: 'created', at: t.created_at, ticket: t });
    }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));

  const logItems = items.filter((i): i is Extract<ActivityItem, { kind: 'log' }> => i.kind === 'log');
  const moves = logItems.filter(i => isStageChange(i.log));
  const movedCount: Record<string, number> = {};
  for (const m of moves) {
    const label = STATUS_LABELS[m.log.new_status as TicketStatus] ?? m.log.new_status;
    movedCount[label] = (movedCount[label] ?? 0) + 1;
  }

  return {
    items,
    summary: {
      updates: logItems.length,
      ticketsTouched: new Set(items.map(i => i.ticket.id)).size,
      newTickets: items.length - logItems.length,
      stageChanges: moves.length,
      movedTo: Object.entries(movedCount).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    },
  };
}

/** Groups items by local calendar day, keeping order. */
export function groupByDay(items: ActivityItem[]): { day: string; items: ActivityItem[] }[] {
  const groups: { day: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const d = new Date(item.at);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
