import { useState, useRef, useCallback } from 'react';
import {
  Ticket, PRIORITY_COLORS, Priority, TicketStatus,
  TicketSubType, SprintStatus, SPRINT_STATUS_LABELS, SPRINT_STATUS_COLORS,
  SortConfig, SortField, FilterConfig,
  getStatusLabel, getStatusColor, isReopenedPending,
  REOPENED_LABEL, REOPENED_COLOR
} from '../types';
import { needsWeeklyUpdate, isHoldExpired, getDaysSinceCreated, sortTickets, applyFilters, AttentionFlag, ticketNeedsAttention, useAllUsers, downloadExcel } from '../hooks/useTickets';
import { extractJiraKey, getJiraUrl } from '../lib/jiraUtils';

interface TicketTableProps {
  tickets: Ticket[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
  selectedTicketId: string | null;
  attentionFlags?: AttentionFlag[];
}

export function TicketTable({ tickets, searchQuery, onSearchChange, onSelectTicket, selectedTicketId, attentionFlags = [] }: TicketTableProps) {
  // Default sort by priority (Critical first)
  const [sort, setSort] = useState<SortConfig>({ field: 'priority', direction: 'asc' });
  const [filters, setFilters] = useState<FilterConfig>({ priority: 'ALL', subType: 'ALL', status: 'ALL', createdBy: 'ALL', assignee: 'ALL' });
  const [showExportModal, setShowExportModal] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const allUsers = useAllUsers();

  const uniqueReporters = tickets.reduce<{ id: string; name: string }[]>((acc, t) => {
    if (t.reporter && !acc.some(r => r.id === t.reporter_id)) {
      acc.push({ id: t.reporter_id, name: t.reporter.full_name });
    }
    return acc;
  }, []).sort((a, b) => a.name.localeCompare(b.name));

  const uniqueAssignees = allUsers
    .filter(u => ['PRODUCT_LEAD', 'PRODUCT_TEAM', 'ADMIN'].includes(u.role))
    .map(u => ({ id: u.id, name: u.full_name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const searched = tickets.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.lab_name.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.custom_id.toLowerCase().includes(q) ||
      t.client_id.toLowerCase().includes(q) ||
      (t.freshdesk_id && t.freshdesk_id.toLowerCase().includes(q)) ||
      (t.latest_comment && t.latest_comment.toLowerCase().includes(q))
    );
  });

  const filtered = applyFilters(searched, filters);
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

  // Column resize handler
  const resizingCol = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = col;
    resizeStartX.current = e.clientX;
    resizeStartW.current = columnWidths[col] || 120;

    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = ev.clientX - resizeStartX.current;
      const newW = Math.max(60, resizeStartW.current + diff);
      setColumnWidths(prev => ({ ...prev, [resizingCol.current!]: newW }));
    };
    const onUp = () => {
      resizingCol.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [columnWidths]);

  function ColHeader({ field, label, col }: { field?: SortField; label: string; col: string }) {
    const w = columnWidths[col];
    return (
      <th
        className="text-left px-3 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap relative select-none"
        style={w ? { width: w, minWidth: w } : undefined}
        onClick={field ? () => handleSort(field) : undefined}
      >
        <span className={field ? 'cursor-pointer hover:text-gray-900' : ''}>
          {label}{field && <SortIcon field={field} />}
        </span>
        <div
          className="absolute right-0 top-1 bottom-1 w-1 cursor-col-resize bg-gray-200 rounded hover:bg-blue-500"
          onMouseDown={e => onResizeStart(col, e)}
        />
      </th>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filters Bar */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="flex flex-wrap gap-3 items-center">
          <input type="text" value={searchQuery} onChange={e => onSearchChange(e.target.value)}
            placeholder="Search by Lab, Subject, Client ID, JIRA, or Comment..."
            className="flex-1 min-w-[200px] max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />

          <select value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value as Priority | 'ALL' }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Priorities</option>
            <option value={Priority.CRITICAL}>Critical</option>
            <option value={Priority.HIGH}>High</option>
            <option value={Priority.MEDIUM}>Medium</option>
            <option value={Priority.LOW}>Low</option>
          </select>

          <select value={filters.subType} onChange={e => setFilters(f => ({ ...f, subType: e.target.value as TicketSubType | 'ALL' }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Types</option>
            <option value={TicketSubType.BUG}>Bug</option>
            <option value={TicketSubType.ENHANCEMENT}>Enhancement</option>
            <option value={TicketSubType.FEATURE_REQUEST}>Feature Request</option>
            <option value={TicketSubType.BACKEND_CONFIG}>Backend Config</option>
          </select>

          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value as TicketStatus | 'ALL' | 'REOPENED' }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Statuses</option>
            <option value="REOPENED">Reopened</option>
            <option value={TicketStatus.NEW_ESCALATION}>New Escalation</option>
            <option value={TicketStatus.PENDING_PROD_REVIEW}>Pending Product</option>
            <option value={TicketStatus.IN_PRODUCT_SCOPE}>In Product Scope</option>
            <option value={TicketStatus.IN_PROGRESS}>In Progress</option>
            <option value={TicketStatus.ON_HOLD_UNTIL}>On Hold</option>
            <option value={TicketStatus.RETURNED_TO_CS}>Returned to CS</option>
            <option value={TicketStatus.RESOLVED}>Resolved</option>
            <option value={TicketStatus.RESOLVED_BY_CS}>Resolved by CS Lead</option>
            <option value={TicketStatus.CLOSED}>Closed</option>
          </select>

          <select value={filters.createdBy} onChange={e => setFilters(f => ({ ...f, createdBy: e.target.value }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Creators</option>
            {uniqueReporters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          <select value={filters.assignee} onChange={e => setFilters(f => ({ ...f, assignee: e.target.value }))}
            className="px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">All Assignees</option>
            {uniqueAssignees.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          {(filters.priority !== 'ALL' || filters.subType !== 'ALL' || filters.status !== 'ALL' || filters.createdBy !== 'ALL' || filters.assignee !== 'ALL') && (
            <button onClick={() => setFilters({ priority: 'ALL', subType: 'ALL', status: 'ALL', createdBy: 'ALL', assignee: 'ALL' })}
              className="px-2 py-2 text-xs text-blue-600 hover:text-blue-800 font-medium">Clear filters</button>
          )}

          <button onClick={() => setShowExportModal(true)}
            className="px-3 py-2 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Export List
          </button>
        </div>
      </div>

      {/* Row count */}
      <div className="px-4 py-1.5 bg-white border-b border-gray-200">
        <span className="text-xs text-gray-500">
          Rows: <span className="font-semibold text-gray-700">{sorted.length}</span>
          {sorted.length !== tickets.length && <span className="text-gray-400"> of {tickets.length}</span>}
        </span>
      </div>

      {/* Table with horizontal scroll */}
      <div className="flex-1 overflow-auto">
        <table className="w-max min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
            <tr>
              <ColHeader col="id" label="ID / JIRA" field={undefined} />
              <ColHeader col="jira_status" label="JIRA Status" field={undefined} />
              <ColHeader col="lab" label="Lab / Client" field="lab_name" />
              <ColHeader col="subject" label="Subject" field={undefined} />
              <ColHeader col="type" label="Type" field={undefined} />
              <ColHeader col="priority" label="Priority" field="priority" />
              <ColHeader col="status" label="Status" field="status" />
              <ColHeader col="sprint" label="Sprint" field={undefined} />
              <ColHeader col="assignee" label="Assignee" field={undefined} />
              <ColHeader col="sla" label="SLA" field={undefined} />
              <ColHeader col="comment" label="Latest Comment" field={undefined} />
              <ColHeader col="reporter" label="Created By" field={undefined} />
              <ColHeader col="age" label="Age" field="days_since" />
              <ColHeader col="updated" label="Updated" field="updated_at" />
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr><td colSpan={14} className="px-4 py-12 text-center text-gray-400">
                {searchQuery || filters.priority !== 'ALL' || filters.subType !== 'ALL' || filters.status !== 'ALL' || filters.createdBy !== 'ALL' || filters.assignee !== 'ALL'
                  ? 'No tickets match your filters.' : 'No tickets yet.'}
              </td></tr>
            ) : (
              sorted.map(ticket => {
                const days = getDaysSinceCreated(ticket);
                const attention = ticketNeedsAttention(ticket, attentionFlags);
                const attentionClass = attention === 'sla_breach' ? 'border-l-4 border-l-red-400 bg-red-50/40' : '';
                const jiraKey = extractJiraKey(ticket.freshdesk_id);
                const jiraUrl = getJiraUrl(ticket.freshdesk_id);
                return (
                  <tr key={ticket.id} onClick={() => onSelectTicket(ticket)}
                    className={`cursor-pointer hover:bg-blue-50 transition-colors ${selectedTicketId === ticket.id ? 'bg-blue-50' : ''} ${ticket.is_reopened ? 'border-l-4 border-l-red-500' : ''} ${attentionClass}`}>
                    {/* ID / JIRA column */}
                    <td className="px-3 py-2 font-mono text-xs">
                      {jiraKey ? (
                        <a href={jiraUrl!} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()} className="text-blue-600 hover:text-blue-800 hover:underline font-medium">
                          {jiraKey}
                        </a>
                      ) : (
                        <span className="text-gray-500">{ticket.custom_id}</span>
                      )}
                      {ticket.is_reopened && <span className="ml-1 text-red-600" title="Reopened">🔄</span>}
                    </td>
                    {/* JIRA Status column */}
                    <td className="px-3 py-2">
                      {ticket.jira_status ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{ticket.jira_status}</span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 max-w-[140px]">
                      <div className="font-medium text-gray-900 truncate">{ticket.lab_name}</div>
                      <div className="text-xs text-gray-400 truncate">{ticket.client_id}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{ticket.subject}</td>
                    <td className="px-3 py-2"><span className="text-xs text-gray-500">{ticket.sub_type.replace('_', ' ')}</span></td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[ticket.priority as Priority]}`}>{ticket.priority}</span>
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(ticket)}`}>{getStatusLabel(ticket)}</span>
                        {ticket.is_reopened && !isReopenedPending(ticket) && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${REOPENED_COLOR}`}>{REOPENED_LABEL}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {ticket.sprint_status ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SPRINT_STATUS_COLORS[ticket.sprint_status as SprintStatus]}`}>
                          {SPRINT_STATUS_LABELS[ticket.sprint_status as SprintStatus]}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{
                      ticket.assignee_id ? (allUsers.find(u => u.id === ticket.assignee_id)?.full_name || '—') : <span className="text-gray-300">—</span>
                    }</td>
                    <td className="px-3 py-2"><SLABadge ticket={ticket} /></td>
                    <td className="px-3 py-2 max-w-[150px]">
                      {ticket.latest_comment ? (
                        <span className="text-xs text-gray-500 truncate block" title={ticket.latest_comment}>
                          {ticket.latest_comment.length > 40 ? ticket.latest_comment.slice(0, 40) + '...' : ticket.latest_comment}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{ticket.reporter?.full_name || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${days > 14 ? 'text-red-600' : days > 7 ? 'text-orange-500' : 'text-gray-500'}`}>{days}d</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">{formatRelative(ticket.updated_at)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Export Modal */}
      {showExportModal && <ExportModal tickets={sorted} allUsers={allUsers} onClose={() => setShowExportModal(false)} />}
    </div>
  );
}

// ===== Export Modal with date picker =====
function ExportModal({ tickets, allUsers, onClose }: { tickets: Ticket[]; allUsers: { id: string; full_name: string; role: string }[]; onClose: () => void }) {
  const [period, setPeriod] = useState<'all' | 'week' | 'month' | 'year' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  function getFilteredByDate(): Ticket[] {
    if (period === 'all') return tickets;
    const now = new Date();
    let start: Date;
    switch (period) {
      case 'week': start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7); break;
      case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'year': start = new Date(now.getFullYear(), 0, 1); break;
      case 'custom': start = customStart ? new Date(customStart) : new Date(2020, 0, 1); break;
      default: start = new Date(2020, 0, 1);
    }
    const end = period === 'custom' && customEnd ? new Date(customEnd) : now;
    return tickets.filter(t => {
      const d = new Date(t.created_at);
      return d >= start && d <= end;
    });
  }

  function handleExport() {
    const data = getFilteredByDate();
    downloadExcel(data, `creliohealth-flow-export-${new Date().toISOString().split('T')[0]}.xlsx`, allUsers);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Export Tickets</h3>
        <div className="space-y-3 mb-4">
          <label className="block text-sm font-medium text-gray-700">Time Period</label>
          <select value={period} onChange={e => setPeriod(e.target.value as typeof period)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500">
            <option value="all">All Time</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="custom">Custom Range</option>
          </select>
          {period === 'custom' && (
            <div className="flex gap-2">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="flex-1 px-2 py-2 border border-gray-300 rounded-md text-sm" />
              <span className="self-center text-gray-400">to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="flex-1 px-2 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
          )}
          <p className="text-xs text-gray-500">{getFilteredByDate().length} tickets will be exported</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExport} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700">Export</button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ===== SLA Badge =====
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
  if (ticket.status === TicketStatus.IN_PRODUCT_SCOPE || ticket.status === TicketStatus.IN_PROGRESS) {
    return (
      <span className="text-xs font-medium text-green-600">
        🟢 On Track {breachCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 rounded">{breachCount}x</span>}
      </span>
    );
  }
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
