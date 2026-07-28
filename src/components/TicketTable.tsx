import { Ticket, PRIORITY_COLORS, STATUS_COLORS, STATUS_LABELS, Priority, TicketStatus } from '../types';
import { needsWeeklyUpdate, isHoldExpired } from '../hooks/useTickets';
import { formatDistanceToNow } from 'date-fns';

interface TicketTableProps {
  tickets: Ticket[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
  selectedTicketId: string | null;
}

export function TicketTable({ tickets, searchQuery, onSearchChange, onSelectTicket, selectedTicketId }: TicketTableProps) {
  // Filter by search
  const filtered = tickets.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.lab_name.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.custom_id.toLowerCase().includes(q) ||
      (t.freshdesk_id && t.freshdesk_id.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search Bar */}
      <div className="p-4 bg-white border-b border-gray-200">
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search by Lab Name, Subject, or Freshdesk ID..."
          className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">ID</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Lab / Client</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Subject</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Type</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">SLA</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Created By</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 uppercase text-xs">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                  {searchQuery ? 'No tickets match your search.' : 'No tickets yet.'}
                </td>
              </tr>
            ) : (
              filtered.map(ticket => (
                <tr
                  key={ticket.id}
                  onClick={() => onSelectTicket(ticket)}
                  className={`cursor-pointer hover:bg-indigo-50 transition-colors ${
                    selectedTicketId === ticket.id ? 'bg-indigo-50' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{ticket.custom_id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[160px] truncate">{ticket.lab_name}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{ticket.subject}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500">{ticket.sub_type.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[ticket.priority as Priority]}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[ticket.status as TicketStatus]}`}>
                      {STATUS_LABELS[ticket.status as TicketStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SLABadge ticket={ticket} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {ticket.reporter?.full_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SLABadge({ ticket }: { ticket: Ticket }) {
  if (needsWeeklyUpdate(ticket)) {
    return <span className="text-xs font-medium text-red-600">🔴 NEEDS UPDATE</span>;
  }
  if (isHoldExpired(ticket)) {
    return <span className="text-xs font-medium text-orange-600">⏰ HOLD EXPIRED</span>;
  }
  if (ticket.status === TicketStatus.IN_PRODUCT_SCOPE) {
    return <span className="text-xs font-medium text-green-600">🟢 On Track</span>;
  }
  return <span className="text-xs text-gray-300">—</span>;
}
