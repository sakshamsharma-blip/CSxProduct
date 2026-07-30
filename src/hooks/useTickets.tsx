import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
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

        // Update all expired tickets to PENDING_PROD_REVIEW
        await supabase
          .from('tickets')
          .update({
            status: TicketStatus.PENDING_PROD_REVIEW,
            hold_until_date: null,
          })
          .in('id', expiredIds);

        // Add audit log entries
        const logEntries = expired.map(t => ({
          ticket_id: t.id,
          author_id: t.reporter_id,
          comment: `Hold period expired — automatically moved back to review.`,
          previous_status: TicketStatus.ON_HOLD_UNTIL,
          new_status: TicketStatus.PENDING_PROD_REVIEW,
          hold_target_date: null,
        }));
        await supabase.from('update_logs').insert(logEntries);

        // Re-fetch to get updated data
        const { data: refreshed } = await supabase
          .from('tickets')
          .select('*, reporter:app_users!reporter_id(*)')
          .order('created_at', { ascending: false });
        if (refreshed) setTickets(refreshed as Ticket[]);
      } else {
        setTickets(ticketList);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  return { tickets, loading, error, refetch: fetchTickets, holdExpiredCount };
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

// ===== ROLE-BASED VISIBILITY =====

export function getVisibleTickets(tickets: Ticket[], role: UserRole, userId: string): Ticket[] {
  if (role === UserRole.CS_MANAGER) {
    // CSM sees ONLY their own tickets
    return tickets.filter(t => t.reporter_id === userId);
  }
  if (role === UserRole.PRODUCT_LEAD) {
    // Product Lead only sees tickets escalated to product pipeline
    return tickets.filter(t =>
      t.status === TicketStatus.PENDING_PROD_REVIEW ||
      t.status === TicketStatus.IN_PRODUCT_SCOPE ||
      t.status === TicketStatus.ON_HOLD_UNTIL ||
      t.status === TicketStatus.RESOLVED ||
      t.status === TicketStatus.CLOSED
    );
  }
  // CS_LEAD sees all tickets
  return tickets;
}

// ===== TAB FILTERING =====

export function filterTicketsByTab(tickets: Ticket[], tab: QueueTab, userId?: string): Ticket[] {
  const now = new Date();

  switch (tab) {
    case 'all':
      return tickets;
    case 'my_tickets':
      return tickets.filter(t => t.reporter_id === userId);
    case 'pending_cs':
      return tickets.filter(t => t.status === TicketStatus.NEW_ESCALATION);
    case 'pending_product':
      return tickets.filter(t =>
        t.status === TicketStatus.PENDING_PROD_REVIEW
      );
    case 'in_scope':
      return tickets.filter(t => t.status === TicketStatus.IN_PRODUCT_SCOPE);
    case 'on_hold':
      return tickets.filter(t => t.status === TicketStatus.ON_HOLD_UNTIL);
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
    return true;
  });
}

// ===== SLA & HOLD HELPERS =====

export function needsWeeklyUpdate(ticket: Ticket): boolean {
  if (ticket.status !== TicketStatus.IN_PRODUCT_SCOPE) return false;
  const lastActivity = new Date(ticket.last_product_activity_at);
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

// ===== ATTENTION FLAGS (data-driven, persist until action is taken) =====
// These drive both the row highlighting and notification banners.
// They clear automatically once Product Lead takes the relevant action.

export type AttentionReason = 'hold_expired' | 'sla_breach';

export interface AttentionFlag {
  ticketId: string;
  reason: AttentionReason;
}

export function getAttentionTickets(tickets: Ticket[]): AttentionFlag[] {
  const flags: AttentionFlag[] = [];

  for (const t of tickets) {
    // SLA breach: IN_PRODUCT_SCOPE and no update for 7+ days
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
