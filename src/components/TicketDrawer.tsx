import { useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { Ticket, UpdateLog, TicketStatus, UserRole, STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useTicketLogs } from '../hooks/useTickets';
import { getAvailableTransitions, canPostUpdate } from '../lib/stateMachine';
import { transitionTicket, postProgressUpdate } from '../lib/actions';

interface TicketDrawerProps {
  ticket: Ticket | null;
  onClose: () => void;
  onUpdate: () => void;
}

const TRANSITION_BUTTON_LABELS: Record<string, string> = {
  RESOLVED_BY_CS: 'Solve Internally',
  PENDING_PROD_REVIEW: 'Escalate to Product',
  IN_PRODUCT_SCOPE: 'Accept into Scope',
  ON_HOLD_UNTIL: 'Put on Hold',
  RESOLVED: 'Mark Completed',
};

export function TicketDrawer({ ticket, onClose, onUpdate }: TicketDrawerProps) {
  const { appUser } = useAuth();
  const { logs, loading: logsLoading, refetch: refetchLogs } = useTicketLogs(ticket?.id || null);
  const [comment, setComment] = useState('');
  const [holdDate, setHoldDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHoldPicker, setShowHoldPicker] = useState(false);

  if (!ticket) return null;

  const userRole = appUser?.role as UserRole;
  const availableTransitions = getAvailableTransitions(ticket.status as TicketStatus, userRole);
  const canUpdate = canPostUpdate(ticket.status as TicketStatus, userRole);

  async function handleTransition(newStatus: TicketStatus) {
    if (!ticket || !appUser) return;
    if (!comment.trim()) {
      setError('Please add a comment before taking action.');
      return;
    }
    if (newStatus === TicketStatus.ON_HOLD_UNTIL && !holdDate) {
      setShowHoldPicker(true);
      setError('Please select a hold-until date.');
      return;
    }

    setActionLoading(true);
    setError('');
    try {
      await transitionTicket({
        ticketId: ticket!.id,
        currentStatus: ticket!.status as TicketStatus,
        newStatus,
        userId: appUser!.id,
        userRole,
        comment,
        holdUntilDate: newStatus === TicketStatus.ON_HOLD_UNTIL ? new Date(holdDate).toISOString() : undefined,
      });
      setComment('');
      setHoldDate('');
      setShowHoldPicker(false);
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
    setActionLoading(false);
  }

  async function handlePostUpdate() {
    if (!ticket || !appUser) return;
    if (!comment.trim()) {
      setError('Please add a comment for the progress update.');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      await postProgressUpdate({
        ticketId: ticket!.id,
        currentStatus: ticket!.status as TicketStatus,
        userId: appUser!.id,
        userRole,
        comment,
      });
      setComment('');
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
    setActionLoading(false);
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm text-gray-500">{ticket.custom_id}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[ticket.priority as keyof typeof PRIORITY_COLORS]}`}>
              {ticket.priority}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[ticket.status as TicketStatus]}`}>
              {STATUS_LABELS[ticket.status as TicketStatus]}
            </span>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 truncate">{ticket.lab_name}</h2>
          <p className="text-sm text-gray-600 truncate">{ticket.subject}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-1"
          aria-label="Close drawer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Section 1: Issue Context */}
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Issue Details</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{ticket.description || 'No description provided.'}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div>
              <span className="font-medium">Reporter:</span> {ticket.reporter?.full_name || '—'}
            </div>
            <div>
              <span className="font-medium">Type:</span> {ticket.sub_type.replace('_', ' ')}
            </div>
            <div>
              <span className="font-medium">Freshdesk:</span> {ticket.freshdesk_id || '—'}
            </div>
            <div>
              <span className="font-medium">Created:</span> {format(new Date(ticket.created_at), 'dd MMM yyyy, HH:mm')}
            </div>
            {ticket.hold_until_date && (
              <div className="col-span-2">
                <span className="font-medium">On Hold Until:</span> {format(new Date(ticket.hold_until_date), 'dd MMM yyyy')}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Action Bar */}
        {(availableTransitions.length > 0 || canUpdate) && (
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Actions</h3>

            {/* Comment input */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add a comment (required for all actions)..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-3"
            />

            {/* Hold date picker */}
            {(showHoldPicker || availableTransitions.includes(TicketStatus.ON_HOLD_UNTIL)) && (
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">Hold Until Date</label>
                <input
                  type="date"
                  value={holdDate}
                  onChange={e => setHoldDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-red-700 px-3 py-2 rounded-md text-xs mb-3">
                {error}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {availableTransitions.map(status => (
                <button
                  key={status}
                  onClick={() => handleTransition(status)}
                  disabled={actionLoading}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
                    status === TicketStatus.RESOLVED || status === TicketStatus.RESOLVED_BY_CS
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : status === TicketStatus.ON_HOLD_UNTIL
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {TRANSITION_BUTTON_LABELS[status] || status}
                </button>
              ))}
              {canUpdate && (
                <button
                  onClick={handlePostUpdate}
                  disabled={actionLoading}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  Post Weekly Update
                </button>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Timeline Feed */}
        <div className="p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity Timeline</h3>

          {logsLoading ? (
            <p className="text-sm text-gray-400">Loading timeline...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-400">No activity yet.</p>
          ) : (
            <div className="space-y-4">
              {logs.map(log => (
                <TimelineEntry key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineEntry({ log }: { log: UpdateLog }) {
  const isStatusChange = log.previous_status !== log.new_status;

  return (
    <div className="relative pl-6 pb-4 border-l-2 border-gray-200 last:border-l-0">
      <div className="absolute left-[-5px] top-1 w-2 h-2 bg-indigo-500 rounded-full"></div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-gray-900">{log.author?.full_name || 'Unknown'}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
          {log.author?.role?.replace('_', ' ') || ''}
        </span>
        <span className="text-xs text-gray-400">
          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
        </span>
      </div>
      {isStatusChange && (
        <div className="text-xs text-gray-500 mb-1">
          <span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS[log.previous_status as TicketStatus]}`}>
            {STATUS_LABELS[log.previous_status as TicketStatus]}
          </span>
          <span className="mx-1">→</span>
          <span className={`px-1.5 py-0.5 rounded ${STATUS_COLORS[log.new_status as TicketStatus]}`}>
            {STATUS_LABELS[log.new_status as TicketStatus]}
          </span>
        </div>
      )}
      {log.hold_target_date && (
        <p className="text-xs text-orange-600 mb-1">
          Hold until: {format(new Date(log.hold_target_date), 'dd MMM yyyy')}
        </p>
      )}
      <p className="text-sm text-gray-700">{log.comment}</p>
    </div>
  );
}
