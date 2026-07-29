import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Ticket, UpdateLog, TicketStatus, QueueTab, UserRole, SortConfig, FilterConfig, Priority, TicketSubType, PRIORITY_ORDER } from '../types';

export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*, reporter:app_users!reporter_id(*)')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setTickets(data as Ticket[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  return { tickets, loading, error, refetch: fetchTickets };
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
        t.status === TicketStatus.PENDING_PROD_REVIEW ||
        (t.status === TicketStatus.ON_HOLD_UNTIL &&
          t.hold_until_date &&
          new Date(t.hold_until_date) <= now)
      );
    case 'in_scope':
      return tickets.filter(t => t.status === TicketStatus.IN_PRODUCT_SCOPE);
    case 'on_hold':
      return tickets.filter(t =>
        t.status === TicketStatus.ON_HOLD_UNTIL &&
        t.hold_until_date &&
        new Date(t.hold_until_date) > now
      );
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
