import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { syncJiraStatuses } from '../lib/jiraSync';
import { Ticket, UpdateLog, TicketStatus, QueueTab, UserRole, SortConfig, FilterConfig, Priority, TicketSubType, PRIORITY_ORDER } from '../types';

export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdExpiredCount, setHoldExpiredCount] = useState(0);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*, reporter:app_users!reporter_id(*)')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      const ticketList = data as Ticket[];

      // Auto-transition expired holds to PENDING_PROD_REVIEW
      const expired = ticketList.filter(t =>
        t.status === TicketStatus.ON_HOLD_UNTIL &&
        t.hold_until_date &&
        new Date(t.hold_until_date) <= new Date()
      );

      if (expired.length > 0) {
        setHoldExpiredCount(expired.length);
        const expiredIds = expired.map(t => t.id);

        await supabase
          .from('tickets')
          .update({
            status: TicketStatus.PENDING_PROD_REVIEW,
            hold_until_date: null,
          })
          .in('id', expiredIds);

        const logEntries = expired.map(t => ({
          ticket_id: t.id,
          author_id: t.reporter_id,
          comment: `Hold period expired — automatically moved back to review.`,
          previous_status: TicketStatus.ON_HOLD_UNTIL,
          new_status: TicketStatus.PENDING_PROD_REVIEW,
          hold_target_date: null,
        }));
        await supabase.from('update_logs').insert(logEntries);

        const { data: refreshed } = await supabase
          .from('tickets')
          .select('*, reporter:app_users!reporter_id(*)')
          .order('created_at', { ascending: false });
        if (refreshed) {
          await updateSlaBreachCounts(refreshed as Ticket[]);
          const { data: final } = await supabase
            .from('tickets')
            .select('*, reporter:app_users!reporter_id(*)')
            .order('created_at', { ascending: false });
          setTickets((final || refreshed) as Ticket[]);
        }
      } else {
        await updateSlaBreachCounts(ticketList);
        const { data: refreshed } = await supabase
          .from('tickets')
          .select('*, reporter:app_users!reporter_id(*)')
          .order('created_at', { ascending: false });
        setTickets((refreshed || ticketList) as Ticket[]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Sync JIRA statuses in background after tickets load
  useEffect(() => {
    if (tickets.length > 0) {
      syncJiraStatuses(tickets).then(() => {
        // Re-fetch to pick up updated jira_status values
        supabase
          .from('tickets')
          .select('*, reporter:app_users!reporter_id(*)')
          .order('created_at', { ascending: false })
          .then(({ data }) => {
            if (data) setTickets(data as Ticket[]);
          });
      });
    }
  }, [tickets.length]); // Only re-run when ticket count changes (i.e. initial load)

  return { tickets, loading, error, refetch: fetchTickets, holdExpiredCount };
}

// SLA breach count updater
async function updateSlaBreachCounts(tickets: Ticket[]) {
  const now = new Date();
  const updates: { id: string; count: number }[] = [];

  for (const t of tickets) {
    if (t.status !== TicketStatus.IN_PRODUCT_SCOPE && t.status !== TicketStatus.IN_PROGRESS) continue;
    const lastActivity = new Date(t.last_product_activity_at);
    const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < 7) continue;

    const expectedBreaches = Math.floor(daysSince / 7);
    if (expectedBreaches > (t.sla_breach_count || 0)) {
      updates.push({ id: t.id, count: expectedBreaches });
    }
  }

  for (const u of updates) {
    await supabase
      .from('tickets')
      .update({ sla_breach_count: u.count })
      .eq('id', u.id);
  }
}

export function useTicketLogs(ticketId: string | null) {
  const [logs, setLogs] = useState<UpdateLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!ticketId) {
      setLogs([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('update_logs')
      .select('*, author:app_users!author_id(*)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching logs:', error);
    } else {
      setLogs(data as UpdateLog[]);
    }
    setLoading(false);
  }, [ticketId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { logs, loading, refetch: fetchLogs };
}

// Fetch all users (for assignee dropdown, created by filter)
export function useAllUsers() {
  const [users, setUsers] = useState<{ id: string; full_name: string; role: string }[]>([]);

  useEffect(() => {
    supabase
      .from('app_users')
      .select('id, full_name, role')
      .order('full_name')
      .then(({ data }) => {
        if (data) setUsers(data);
      });
  }, []);

  return users;
}

// ===== ROLE-BASED VISIBILITY =====

export function getVisibleTickets(tickets: Ticket[], role: UserRole, userId: string): Ticket[] {
  if (role === UserRole.ADMIN) {
    return tickets;
  }
  if (role === UserRole.CS_MANAGER) {
    return tickets.filter(t => t.reporter_id === userId);
  }
  if (role === UserRole.PRODUCT_LEAD || role === UserRole.PRODUCT_TEAM) {
    return tickets.filter(t =>
      t.status === TicketStatus.PENDING_PROD_REVIEW ||
      t.status === TicketStatus.IN_PRODUCT_SCOPE ||
      t.status === TicketStatus.IN_PROGRESS ||
      t.status === TicketStatus.ON_HOLD_UNTIL ||
      t.status === TicketStatus.RESOLVED ||
      t.status === TicketStatus.RETURNED_TO_CS ||
      t.status === TicketStatus.CLOSED
    );
  }
  // CS_LEAD sees all tickets
  return tickets;
}

// ===== TAB FILTERING =====

export function filterTicketsByTab(tickets: Ticket[], tab: QueueTab, userId?: string): Ticket[] {
  switch (tab) {
    case 'all':
      return tickets;
    case 'pending_cs':
      return tickets.filter(t => t.status === TicketStatus.NEW_ESCALATION);
    case 'pending_product':
      // Auto-sort pending review by priority (Critical first)
      return tickets
        .filter(t => t.status === TicketStatus.PENDING_PROD_REVIEW)
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    case 'in_scope':
      return tickets.filter(t => t.status === TicketStatus.IN_PRODUCT_SCOPE);
    case 'in_progress':
      return tickets.filter(t => t.status === TicketStatus.IN_PROGRESS);
    case 'on_hold':
      return tickets.filter(t => t.status === TicketStatus.ON_HOLD_UNTIL);
    case 'returned_to_cs':
      return tickets.filter(t => t.status === TicketStatus.RETURNED_TO_CS);
    case 'resolved':
      return tickets.filter(t =>
        t.status === TicketStatus.RESOLVED ||
        t.status === TicketStatus.RESOLVED_BY_CS
      );
    case 'closed':
      return tickets.filter(t => t.status === TicketStatus.CLOSED);
    default:
      return tickets;
  }
}

// ===== SORTING =====

export function sortTickets(tickets: Ticket[], sort: SortConfig): Ticket[] {
  const sorted = [...tickets].sort((a, b) => {
    let comparison = 0;

    switch (sort.field) {
      case 'priority':
        comparison = PRIORITY_ORDER[a.priority as Priority] - PRIORITY_ORDER[b.priority as Priority];
        break;
      case 'created_at':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case 'updated_at':
        comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
        break;
      case 'status':
        comparison = a.status.localeCompare(b.status);
        break;
      case 'lab_name':
        comparison = a.lab_name.localeCompare(b.lab_name);
        break;
      case 'client_id':
        comparison = a.client_id.localeCompare(b.client_id);
        break;
      case 'days_since':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      default:
        comparison = 0;
    }

    return sort.direction === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

// ===== FILTER BY DROPDOWNS =====

export function applyFilters(tickets: Ticket[], filters: FilterConfig): Ticket[] {
  return tickets.filter(t => {
    if (filters.priority !== 'ALL' && t.priority !== filters.priority) return false;
    if (filters.subType !== 'ALL' && t.sub_type !== filters.subType) return false;
    if (filters.status === 'REOPENED') {
      if (!t.is_reopened) return false;
    } else if (filters.status !== 'ALL' && t.status !== filters.status) {
      return false;
    }
    if (filters.createdBy !== 'ALL' && t.reporter_id !== filters.createdBy) return false;
    if (filters.assignee !== 'ALL' && t.assignee_id !== filters.assignee) return false;
    return true;
  });
}

// ===== SLA & HOLD HELPERS =====

export function needsWeeklyUpdate(ticket: Ticket): boolean {
  if (ticket.status !== TicketStatus.IN_PRODUCT_SCOPE && ticket.status !== TicketStatus.IN_PROGRESS) return false;
  
  // SLA breach = 7+ days with no manual update AND no JIRA status change
  const lastManualActivity = new Date(ticket.last_product_activity_at).getTime();
  const lastJiraChange = ticket.last_jira_status_change_at
    ? new Date(ticket.last_jira_status_change_at).getTime()
    : 0;
  const lastActivity = new Date(Math.max(lastManualActivity, lastJiraChange));
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return lastActivity < sevenDaysAgo;
}

export function isHoldExpired(ticket: Ticket): boolean {
  if (ticket.status !== TicketStatus.ON_HOLD_UNTIL) return false;
  if (!ticket.hold_until_date) return false;
  return new Date(ticket.hold_until_date) <= new Date();
}

export function getDaysSinceCreated(ticket: Ticket): number {
  const created = new Date(ticket.created_at);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ===== ATTENTION FLAGS =====

export type AttentionReason = 'hold_expired' | 'sla_breach';

export interface AttentionFlag {
  ticketId: string;
  reason: AttentionReason;
}

export function getAttentionTickets(tickets: Ticket[]): AttentionFlag[] {
  const flags: AttentionFlag[] = [];

  for (const t of tickets) {
    if (needsWeeklyUpdate(t)) {
      flags.push({ ticketId: t.id, reason: 'sla_breach' });
    }
  }

  return flags;
}

export function ticketNeedsAttention(ticket: Ticket, attentionFlags: AttentionFlag[]): AttentionReason | null {
  const flag = attentionFlags.find(f => f.ticketId === ticket.id);
  return flag?.reason || null;
}

// ===== EXCEL EXPORT =====

export function exportTicketsToExcel(tickets: Ticket[]) {
  const rows = tickets.map(t => ({
    'ID': t.custom_id,
    'Lab/Client': t.lab_name,
    'Client ID': t.client_id,
    'Subject': t.subject,
    'Type': t.sub_type,
    'Priority': t.priority,
    'Status': t.status,
    'Sprint Status': t.sprint_status || '',
    'Reporter': t.reporter?.full_name || '',
    'JIRA': t.freshdesk_id || '',
    'JIRA Status': t.jira_status || '',
    'SLA Breaches': t.sla_breach_count || 0,
    'Days Since Created': getDaysSinceCreated(t),
    'Latest Comment': t.latest_comment || '',
    'Created At': new Date(t.created_at).toLocaleDateString(),
    'Updated At': new Date(t.updated_at).toLocaleDateString(),
  }));
  return rows;
}

export async function downloadExcel(tickets: Ticket[], filename: string) {
  const XLSX = await import('xlsx');
  const data = exportTicketsToExcel(tickets);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
  XLSX.writeFile(wb, filename);
}
