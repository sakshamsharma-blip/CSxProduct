import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Ticket, UpdateLog, TicketStatus, QueueTab } from '../types';

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

export function filterTicketsByTab(tickets: Ticket[], tab: QueueTab, userId?: string): Ticket[] {
  const now = new Date();

  switch (tab) {
    case 'all':
      return tickets;
    case 'my_tickets':
      return tickets.filter(t => t.reporter_id === userId);
    case 'pending_cs':
      return tickets.filter(t => t.status === TicketStatus.NEW_ESCALATION);
    case 'pending_product': {
      // Include PENDING_PROD_REVIEW + expired ON_HOLD_UNTIL
      return tickets.filter(t =>
        t.status === TicketStatus.PENDING_PROD_REVIEW ||
        (t.status === TicketStatus.ON_HOLD_UNTIL &&
          t.hold_until_date &&
          new Date(t.hold_until_date) <= now)
      );
    }
    case 'in_scope':
      return tickets.filter(t => t.status === TicketStatus.IN_PRODUCT_SCOPE);
    case 'on_hold':
      return tickets.filter(t =>
        t.status === TicketStatus.ON_HOLD_UNTIL &&
        t.hold_until_date &&
        new Date(t.hold_until_date) > now
      );
    case 'closed':
      return tickets.filter(t =>
        t.status === TicketStatus.RESOLVED_BY_CS ||
        t.status === TicketStatus.RESOLVED
      );
    default:
      return tickets;
  }
}

// Filter tickets based on user role visibility
export function getVisibleTickets(tickets: Ticket[], role: string, userId: string): Ticket[] {
  if (role === 'PRODUCT_LEAD') {
    // Product Lead only sees tickets escalated to product pipeline
    return tickets.filter(t =>
      t.status === TicketStatus.PENDING_PROD_REVIEW ||
      t.status === TicketStatus.IN_PRODUCT_SCOPE ||
      t.status === TicketStatus.ON_HOLD_UNTIL ||
      t.status === TicketStatus.RESOLVED
    );
  }
  // CS_MANAGER and CS_LEAD see all tickets
  return tickets;
}

// SLA check: needs weekly update if IN_PRODUCT_SCOPE and last activity > 7 days
export function needsWeeklyUpdate(ticket: Ticket): boolean {
  if (ticket.status !== TicketStatus.IN_PRODUCT_SCOPE) return false;
  const lastActivity = new Date(ticket.last_product_activity_at);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return lastActivity < sevenDaysAgo;
}

// Hold expiry check
export function isHoldExpired(ticket: Ticket): boolean {
  if (ticket.status !== TicketStatus.ON_HOLD_UNTIL) return false;
  if (!ticket.hold_until_date) return false;
  return new Date(ticket.hold_until_date) <= new Date();
}
