import { Ticket, UpdateLog, TicketStatus, TicketSubType, Priority } from '../types';
import { startOfWeek, startOfMonth, startOfYear, isAfter, differenceInDays, differenceInHours } from 'date-fns';

export type TimePeriod = 'this_week' | 'mtd' | 'ytd' | 'all_time' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
}

export function getDateRange(period: TimePeriod, customStart?: string, customEnd?: string): DateRange {
  const now = new Date();
  switch (period) {
    case 'this_week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: now };
    case 'mtd':
      return { start: startOfMonth(now), end: now };
    case 'ytd':
      return { start: startOfYear(now), end: now };
    case 'all_time':
      return { start: new Date(2020, 0, 1), end: now };
    case 'custom':
      return {
        start: customStart ? new Date(customStart) : new Date(2020, 0, 1),
        end: customEnd ? new Date(customEnd) : now,
      };
    default:
      return { start: new Date(2020, 0, 1), end: now };
  }
}

export function filterByDateRange(tickets: Ticket[], range: DateRange): Ticket[] {
  return tickets.filter(t => {
    const created = new Date(t.created_at);
    return isAfter(created, range.start) && !isAfter(created, range.end);
  });
}

// ===== STAT CARDS =====

export interface StatCards {
  totalRaised: number;
  currentlyOpen: number;
  closed: number;
  reopenRate: number; // percentage
  avgResolutionTAT: number; // hours
  avgClosureTAT: number; // hours
  avgEndToEndTAT: number; // hours
  slaBreaches: number;
}

export function computeStatCards(tickets: Ticket[], allTickets: Ticket[], logs: UpdateLog[]): StatCards {
  const totalRaised = tickets.length;
  const closed = tickets.filter(t => t.status === TicketStatus.CLOSED).length;
  const currentlyOpen = allTickets.filter(t => t.status !== TicketStatus.CLOSED).length;
  const reopened = tickets.filter(t => t.is_reopened).length;
  const reopenRate = totalRaised > 0 ? Math.round((reopened / totalRaised) * 100) : 0;

  // SLA breaches: tickets in IN_PRODUCT_SCOPE with last_product_activity > 7 days
  const slaBreaches = allTickets.filter(t => {
    if (t.status !== TicketStatus.IN_PRODUCT_SCOPE) return false;
    const lastActivity = new Date(t.last_product_activity_at);
    return differenceInDays(new Date(), lastActivity) > 7;
  }).length;

  // TAT calculations from logs
  const resolutionTATs: number[] = [];
  const closureTATs: number[] = [];
  const endToEndTATs: number[] = [];

  for (const ticket of tickets) {
    const ticketLogs = logs.filter(l => l.ticket_id === ticket.id);

    // Find when it entered IN_PRODUCT_SCOPE
    const inScopeLog = ticketLogs.find(l => l.new_status === TicketStatus.IN_PRODUCT_SCOPE);
    // Find when it was RESOLVED
    const resolvedLog = ticketLogs.find(l => l.new_status === TicketStatus.RESOLVED);
    // Find when it was CLOSED
    const closedLog = ticketLogs.find(l => l.new_status === TicketStatus.CLOSED);

    if (inScopeLog && resolvedLog) {
      const hours = differenceInHours(new Date(resolvedLog.created_at), new Date(inScopeLog.created_at));
      if (hours >= 0) resolutionTATs.push(hours);
    }

    if (resolvedLog && closedLog) {
      const hours = differenceInHours(new Date(closedLog.created_at), new Date(resolvedLog.created_at));
      if (hours >= 0) closureTATs.push(hours);
    }

    if (ticket.status === TicketStatus.CLOSED && closedLog) {
      const hours = differenceInHours(new Date(closedLog.created_at), new Date(ticket.created_at));
      if (hours >= 0) endToEndTATs.push(hours);
    }
  }

  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  return {
    totalRaised,
    currentlyOpen,
    closed,
    reopenRate,
    avgResolutionTAT: avg(resolutionTATs),
    avgClosureTAT: avg(closureTATs),
    avgEndToEndTAT: avg(endToEndTATs),
    slaBreaches,
  };
}

// ===== CHART DATA =====

export interface TypeDistribution {
  name: string;
  value: number;
}

export function getTypeDistribution(tickets: Ticket[]): TypeDistribution[] {
  const counts: Record<string, number> = {};
  for (const t of tickets) {
    const label = t.sub_type.replace('_', ' ');
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

export function getPriorityDistribution(tickets: Ticket[]): TypeDistribution[] {
  const order: Priority[] = [Priority.CRITICAL, Priority.HIGH, Priority.MEDIUM, Priority.LOW];
  return order.map(p => ({
    name: p,
    value: tickets.filter(t => t.priority === p).length,
  }));
}

export function getStatusPipeline(tickets: Ticket[]): TypeDistribution[] {
  const statuses: TicketStatus[] = [
    TicketStatus.NEW_ESCALATION,
    TicketStatus.PENDING_PROD_REVIEW,
    TicketStatus.IN_PRODUCT_SCOPE,
    TicketStatus.ON_HOLD_UNTIL,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ];
  return statuses.map(s => ({
    name: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    value: tickets.filter(t => t.status === s).length,
  }));
}

export interface TimeSeriesPoint {
  period: string;
  raised: number;
  resolved: number;
}

export function getRaisedVsResolved(tickets: Ticket[], logs: UpdateLog[]): TimeSeriesPoint[] {
  // Group by month
  const months: Record<string, { raised: number; resolved: number }> = {};

  for (const t of tickets) {
    const month = new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    if (!months[month]) months[month] = { raised: 0, resolved: 0 };
    months[month].raised++;
  }

  for (const l of logs) {
    if (l.new_status === TicketStatus.RESOLVED || l.new_status === TicketStatus.RESOLVED_BY_CS) {
      const month = new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      if (!months[month]) months[month] = { raised: 0, resolved: 0 };
      months[month].resolved++;
    }
  }

  return Object.entries(months).map(([period, data]) => ({ period, ...data }));
}

export interface ClientStat {
  clientName: string;
  clientId: string;
  total: number;
  open: number;
  closed: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  reopenCount: number;
  avgTAT: number; // hours
  slaBreaches: number;
}

export function getTopClients(tickets: Ticket[], logs: UpdateLog[]): ClientStat[] {
  const clientMap: Record<string, Ticket[]> = {};

  for (const t of tickets) {
    const key = `${t.lab_name}|||${t.client_id}`;
    if (!clientMap[key]) clientMap[key] = [];
    clientMap[key].push(t);
  }

  const stats: ClientStat[] = Object.entries(clientMap).map(([key, clientTickets]) => {
    const [clientName, clientId] = key.split('|||');
    const open = clientTickets.filter(t => t.status !== TicketStatus.CLOSED).length;
    const closed = clientTickets.filter(t => t.status === TicketStatus.CLOSED).length;
    const reopenCount = clientTickets.reduce((sum, t) => sum + t.reopen_count, 0);

    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const t of clientTickets) {
      byType[t.sub_type] = (byType[t.sub_type] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }

    // Avg TAT for closed tickets
    const tats: number[] = [];
    for (const t of clientTickets) {
      if (t.status === TicketStatus.CLOSED) {
        const closedLog = logs.find(l => l.ticket_id === t.id && l.new_status === TicketStatus.CLOSED);
        if (closedLog) {
          tats.push(differenceInHours(new Date(closedLog.created_at), new Date(t.created_at)));
        }
      }
    }
    const avgTAT = tats.length > 0 ? Math.round(tats.reduce((a, b) => a + b, 0) / tats.length) : 0;

    // SLA breaches for this client
    const slaBreaches = clientTickets.filter(t => {
      if (t.status !== TicketStatus.IN_PRODUCT_SCOPE) return false;
      return differenceInDays(new Date(), new Date(t.last_product_activity_at)) > 7;
    }).length;

    return {
      clientName,
      clientId,
      total: clientTickets.length,
      open,
      closed,
      byType,
      byPriority,
      reopenCount,
      avgTAT,
      slaBreaches,
    };
  });

  return stats.sort((a, b) => b.total - a.total);
}

// CSM workload: tickets per reporter grouped by type
export interface CSMWorkload {
  name: string;
  total: number;
  bugs: number;
  enhancements: number;
  features: number;
  configs: number;
}

export function getCSMWorkload(tickets: Ticket[]): CSMWorkload[] {
  const reporterMap: Record<string, { name: string; tickets: Ticket[] }> = {};

  for (const t of tickets) {
    const reporterName = t.reporter?.full_name || 'Unknown';
    if (!reporterMap[t.reporter_id]) {
      reporterMap[t.reporter_id] = { name: reporterName, tickets: [] };
    }
    reporterMap[t.reporter_id].tickets.push(t);
  }

  return Object.values(reporterMap).map(({ name, tickets: rTickets }) => ({
    name,
    total: rTickets.length,
    bugs: rTickets.filter(t => t.sub_type === TicketSubType.BUG).length,
    enhancements: rTickets.filter(t => t.sub_type === TicketSubType.ENHANCEMENT).length,
    features: rTickets.filter(t => t.sub_type === TicketSubType.FEATURE_REQUEST).length,
    configs: rTickets.filter(t => t.sub_type === TicketSubType.BACKEND_CONFIG).length,
  })).sort((a, b) => b.total - a.total);
}

// Oldest open tickets
export function getOldestOpen(tickets: Ticket[]): Ticket[] {
  return tickets
    .filter(t => t.status !== TicketStatus.CLOSED)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, 10);
}

// Format hours to human readable
export function formatTAT(hours: number): string {
  if (hours === 0) return '—';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}
