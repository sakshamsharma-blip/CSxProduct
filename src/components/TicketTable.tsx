import { useState } from 'react';
import {
  Ticket, PRIORITY_COLORS, Priority, TicketStatus,
  TicketSubType, SprintStatus, SPRINT_STATUS_LABELS, SPRINT_STATUS_COLORS,
  SortConfig, SortField, FilterConfig,
  getStatusLabel, getStatusColor, isReopenedPending,
  REOPENED_LABEL, REOPENED_COLOR
} from '../types';
import { needsWeeklyUpdate, isHoldExpired, getDaysSinceCreated, sortTickets, applyFilters, AttentionFlag, ticketNeedsAttention } from '../hooks/useTickets';

interface TicketTableProps {
  tickets: Ticket[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
  selectedTicketId: string | null;
  attentionFlags?: AttentionFlag[];
}

export function TicketTable({ tickets, searchQuery, onSearchChange, onSelectTicket, selectedTicketId, attentionFlags = [] }: TicketTableProps) {
  const [sort, setSort] = useState<SortConfig>({ field: 'created_at', direction: 'desc' });
  const [filters, setFilters] = useState<FilterConfig>({ priority: 'ALL', subType: 'ALL', status: 'ALL', createdBy: 'ALL' });

  // Build unique reporters list for the "Created By" filter
  const uniqueReporters = tickets.reduce<{ id: string; name: string }[]>((acc, t) => {
    if (t.reporter && !acc.some(r => r.id === t.reporter_id)) {
      acc.push({ id: t.reporter_id, name: t.reporter.full_name });
    }
    return acc;
  }, []).sort((a, b) => a.name.localeCompare(b.name));

  // Apply search
  const searched = tickets.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.lab_name.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.custom_id.toLowerCase().includes(q) ||
      t.client_id.toLowerCase().includes(q) ||
      (t.freshdesk_id && t.freshdesk_id.toLowerCase().includes(q))
    );
  });

  // Apply filters
  const filtered = applyFilters(searched, filters);

  // Apply sort
  const sorted = sortTickets(filtered, sort);

  function handleSort(field: SortField) {
    setSort(prev =>
      prev.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' }
    );
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sort.field !== field) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="ml-1">{sort.direction === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search + Filters Bar */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search by Lab, Subject, Client ID, or Freshdesk..."
            className="flex-1 min-w-[200px] max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
          />

          {/* Priority Filter */}
          <select
            value={filters.priority}
            onChange={e => setFilters(f => ({ ...f, priority: e.target.value as Priority | 'ALL' }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Priorities</option>
            <option value={Priority.CRITICAL}>Critical</option>
            <option value={Priority.HIGH}>High</option>
            <option value={Priority.MEDIUM}>Medium</option>
            <option value={Priority.LOW}>Low</option>
          </select>

          {/* Sub-Type Filter */}
          <select
            value={filters.subType}
            onChange={e => setFilters(f => ({ ...f, subType: e.target.value as TicketSubType | 'ALL' }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Types</option>
            <option value={TicketSubType.BUG}>Bug</option>
            <option value={TicketSubType.ENHANCEMENT}>Enhancement</option>
            <option value={TicketSubType.FEATURE_REQUEST}>Feature Request</option>
            <option value={TicketSubType.BACKEND_CONFIG}>Backend Config</option>
          </select>

          {/* Status Filter */}
          <select
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value as TicketStatus | 'ALL' | 'REOPENED' }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="REOPENED">Reopened</option>
            <option value={TicketStatus.NEW_ESCALATION}>New Escalation</option>
            <option value={TicketStatus.PENDING_PROD_REVIEW}>Pending Product</option>
            <option value={TicketStatus.IN_PRODUCT_SCOPE}>In Product Scope</option>
            <option value={TicketStatus.ON_HOLD_UNTIL}>On Hold</option>
            <option value={TicketStatus.RESOLVED}>Resolved</option>
            <option value={TicketStatus.RESOLVED_BY_CS}>Resolved by CS</option>
            <option value={TicketStatus.CLOSED}>Closed</option>
          </select>

          {/* Created By Filter */}
          <select
            value={filters.createdBy}
            onChange={e => setFilters(f => ({ ...f, createdBy: e.target.value }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Creators</option>
            {uniqueReporters.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          {/* Reset Filters */}
          {(filters.priority !== 'ALL' || filters.subType !== 'ALL' || filters.status !== 'ALL' || filters.createdBy !== 'ALL') && (
            <button
              onClick={() => setFilters({ priority: 'ALL', subType: 'ALL', status: 'ALL', createdBy: 'ALL' })}
              className="px-2 py-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Row count, mirroring the "Rows: N" readout used across the LIMS tables */}
      <div className="px-4 py-1.5 bg-white border-b border-hairline">
        <span className="text-xs text-gray-500">
          Rows: <span className="font-semibold text-gray-700">{sorted.length}</span>
          {sorted.length !== tickets.length && (
            <span className="text-gray-400"> of {tickets.length}</span>
          )}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F1F3F5] sticky top-0 border-b border-hairline">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap">ID</th>
              <th
                className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap cursor-pointer hover:text-gray-700"
                onClick={() => handleSort('lab_name')}
              >
                Lab / Client <SortIcon field="lab_name" />
              </th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap">Subject</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap">Type</th>
              <th
                className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap cursor-pointer hover:text-gray-700"
                onClick={() => handleSort('priority')}
              >
                Priority <SortIcon field="priority" />
              </th>
              <th
                className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap cursor-pointer hover:text-gray-700"
                onClick={() => handleSort('status')}
              >
                Status <SortIcon field="status" />
              </th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap">Sprint</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap">SLA</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap">Created By</th>
              <th
                className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap cursor-pointer hover:text-gray-700"
                onClick={() => handleSort('days_since')}
              >
                Age <SortIcon field="days_since" />
              </th>
              <th
                className="text-left px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap cursor-pointer hover:text-gray-700"
                onClick={() => handleSort('updated_at')}
              >
                Updated <SortIcon field="updated_at" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-gray-400">
                  {searchQuery || filters.priority !== 'ALL' || filters.subType !== 'ALL' || filters.status !== 'ALL'
                    ? 'No tickets match your filters.'
                    : 'No tickets yet.'}
                </td>
              </tr>
            ) : (
              sorted.map(ticket => {
                const days = getDaysSinceCreated(ticket);
                const attention = ticketNeedsAttention(ticket, attentionFlags);
                const attentionClass = attention === 'sla_breach'
                  ? 'border-l-4 border-l-red-400 bg-red-50/40'
                  : attention === 'hold_expired'
                  ? 'border-l-4 border-l-orange-400 bg-orange-50/40'
                  : '';
                return (
                  <tr
                    key={ticket.id}
                    onClick={() => onSelectTicket(ticket)}
                    className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                      selectedTicketId === ticket.id ? 'bg-blue-50' : ''
                    } ${ticket.is_reopened ? 'border-l-4 border-l-red-500' : ''} ${attentionClass}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {ticket.custom_id}
                      {ticket.is_reopened && <span className="ml-1 text-red-600" title="This ticket was reopened">🔄</span>}
                    </td>
                    <td className="px-3 py-2 max-w-[140px]">
                      <div className="font-medium text-gray-900 truncate">{ticket.lab_name}</div>
                      <div className="text-xs text-gray-400 truncate">{ticket.client_id}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">{ticket.subject}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-gray-500">{ticket.sub_type.replace('_', ' ')}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[ticket.priority as Priority]}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(ticket)}`}>
                          {getStatusLabel(ticket)}
                        </span>
                        {/* Reopened stays visible at every stage, not just while in triage */}
                        {ticket.is_reopened && !isReopenedPending(ticket) && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${REOPENED_COLOR}`}>
                            {REOPENED_LABEL}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {ticket.sprint_status ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SPRINT_STATUS_COLORS[ticket.sprint_status as SprintStatus]}`}>
                          {SPRINT_STATUS_LABELS[ticket.sprint_status as SprintStatus]}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <SLABadge ticket={ticket} />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {ticket.reporter?.full_name || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${days > 14 ? 'text-red-600' : days > 7 ? 'text-orange-500' : 'text-gray-500'}`}>
                        {days}d
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {formatRelative(ticket.updated_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SLABadge({ ticket }: { ticket: Ticket }) {
  const breachCount = ticket.sla_breach_count || 0;

  if (needsWeeklyUpdate(ticket)) {
    return (
      <span className="text-xs font-medium text-red-600">
        🔴 NEEDS UPDATE {breachCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-100 rounded">{breachCount}x</span>}
      </span>
    );
  }
  if (isHoldExpired(ticket)) {
    return <span className="text-xs font-medium text-orange-600">⏰ EXPIRED</span>;
  }
  if (ticket.status === TicketStatus.IN_PRODUCT_SCOPE) {
    return (
      <span className="text-xs font-medium text-green-600">
        🟢 On Track {breachCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 rounded">{breachCount}x</span>}
      </span>
    );
  }
  // Show breach count on closed/resolved tickets too (historical)
  if (breachCount > 0) {
    return <span className="text-xs font-medium text-gray-500">SLA: {breachCount}x</span>;
  }
  return <span className="text-xs text-gray-300">—</span>;
}

function formatRelative(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
