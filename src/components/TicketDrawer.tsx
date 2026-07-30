import { useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Ticket, UpdateLog, TicketStatus, UserRole, Priority, SprintStatus,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, SPRINT_STATUS_LABELS, SPRINT_STATUS_COLORS,
  getStatusLabel, getStatusColor, isReopenedPending
} from '../types';
import { useAuth } from '../hooks/useAuth';
import { useTicketLogs } from '../hooks/useTickets';
import { getAvailableTransitions, canPostUpdate, canChangePriority, canChangeSprintStatus, canRevertLastAction } from '../lib/stateMachine';
import { transitionTicket, postProgressUpdate, changePriority, changeSprintStatus, revertLastAction } from '../lib/actions';

interface TicketDrawerProps {
  ticket: Ticket | null;
  onClose: () => void;
  onUpdate: () => void;
}

/**
 * Supabase rejects with plain objects rather than Error instances, so an
 * `instanceof Error` check swallows the actual reason. Pull the message out.
 */
function describeError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const candidate = err as { message?: unknown; details?: unknown; hint?: unknown };
    for (const value of [candidate.message, candidate.details, candidate.hint]) {
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

// Green = resolving/completing work, blue = moving it forward, gray = parking, red = reopening.
const TRANSITION_BUTTON_LABELS: Record<string, { label: string; color: string }> = {
  RESOLVED_BY_CS: { label: 'Solve Internally', color: 'bg-emerald-600 hover:bg-emerald-700' },
  PENDING_PROD_REVIEW: { label: 'Escalate to Product', color: 'bg-purple-600 hover:bg-purple-700' },
  IN_PRODUCT_SCOPE: { label: 'Accept into Scope', color: 'bg-blue-600 hover:bg-blue-700' },
  ON_HOLD_UNTIL: { label: 'Put on Hold', color: 'bg-orange-500 hover:bg-orange-600' },
  RESOLVED: { label: 'Mark Resolved', color: 'bg-green-600 hover:bg-green-700' },
  CLOSED: { label: 'Close Ticket', color: 'bg-gray-700 hover:bg-gray-800' },
  NEW_ESCALATION: { label: 'Reopen', color: 'bg-red-500 hover:bg-red-600' },
};

export function TicketDrawer({ ticket, onClose, onUpdate }: TicketDrawerProps) {
  const { appUser } = useAuth();
  const { logs, loading: logsLoading, refetch: refetchLogs } = useTicketLogs(ticket?.id || null);
  const [comment, setComment] = useState('');
  const [holdDate, setHoldDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  if (!ticket || !appUser) return null;

  const userRole = appUser.role as UserRole;
  const userId = appUser.id;
  const reporterId = ticket.reporter_id;

  const availableTransitions = getAvailableTransitions(ticket.status as TicketStatus, userRole, userId, reporterId);
  const showPostUpdate = canPostUpdate(ticket.status as TicketStatus, userRole);
  const showPriorityChange = canChangePriority(userRole);
  const showSprintStatus = canChangeSprintStatus(ticket.status as TicketStatus, userRole);
  const showRevert = canRevertLastAction(userRole);

  async function handleTransition(newStatus: TicketStatus) {
    if (!ticket || !appUser) return;
    if (!comment.trim()) {
      setError('Please add a comment before taking action.');
      return;
    }
    if (newStatus === TicketStatus.ON_HOLD_UNTIL && !holdDate) {
      setError('Please select a hold-until date.');
      return;
    }

    setActionLoading(true);
    setError('');
    try {
      await transitionTicket({
        ticketId: ticket.id,
        currentStatus: ticket.status as TicketStatus,
        newStatus,
        userId: appUser.id,
        userRole,
        reporterId: ticket.reporter_id,
        comment,
        holdUntilDate: newStatus === TicketStatus.ON_HOLD_UNTIL ? new Date(holdDate).toISOString() : undefined,
      });
      setComment('');
      setHoldDate('');
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Action failed'));
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
        ticketId: ticket.id,
        currentStatus: ticket.status as TicketStatus,
        userId: appUser.id,
        userRole,
        comment,
      });
      setComment('');
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Action failed'));
    }
    setActionLoading(false);
  }

  async function handlePriorityChange(newPriority: Priority) {
    if (!ticket || !appUser) return;
    setActionLoading(true);
    setError('');
    try {
      await changePriority({
        ticketId: ticket.id,
        currentStatus: ticket.status as TicketStatus,
        oldPriority: ticket.priority as Priority,
        newPriority,
        userId: appUser.id,
        userRole,
      });
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Failed to change priority'));
    }
    setActionLoading(false);
  }

  async function handleSprintStatusChange(newSprintStatus: SprintStatus) {
    if (!ticket || !appUser) return;
    setActionLoading(true);
    setError('');
    try {
      await changeSprintStatus({
        ticketId: ticket.id,
        currentStatus: ticket.status as TicketStatus,
        newSprintStatus,
        userId: appUser.id,
        userRole,
      });
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Failed to change sprint status'));
    }
    setActionLoading(false);
  }

  async function handleRevert() {
    if (!ticket || !appUser) return;
    setActionLoading(true);
    setError('');
    try {
      await revertLastAction({
        ticketId: ticket.id,
        userId: appUser.id,
        userRole,
      });
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Failed to revert'));
    }
    setActionLoading(false);
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-sm text-gray-500">{ticket.custom_id}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[ticket.priority as Priority]}`}>
              {ticket.priority}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(ticket)}`}>
              {getStatusLabel(ticket)}
            </span>
            {/* Once a reopened ticket moves past triage, keep a marker so leads still see the history */}
            {ticket.is_reopened && !isReopenedPending(ticket) && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                Reopened
              </span>
            )}
            {ticket.sprint_status && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${SPRINT_STATUS_COLORS[ticket.sprint_status as SprintStatus]}`}>
                {SPRINT_STATUS_LABELS[ticket.sprint_status as SprintStatus]}
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold text-gray-900 truncate">{ticket.lab_name}</h2>
          <p className="text-sm text-gray-600 truncate">{ticket.subject}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Close drawer">
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
            <div><span className="font-medium">Reporter:</span> {ticket.reporter?.full_name || '—'}</div>
            <div><span className="font-medium">Client ID:</span> {ticket.client_id || '—'}</div>
            <div><span className="font-medium">Type:</span> {ticket.sub_type.replace('_', ' ')}</div>
            <div><span className="font-medium">Freshdesk:</span> {ticket.freshdesk_id || '—'}</div>
            <div><span className="font-medium">Created:</span> {format(new Date(ticket.created_at), 'dd MMM yyyy, HH:mm')}</div>
            <div><span className="font-medium">Updated:</span> {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}</div>
            {ticket.hold_until_date && (
              <div className="col-span-2">
                <span className="font-medium">On Hold Until:</span> {format(new Date(ticket.hold_until_date), 'dd MMM yyyy')}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Priority Change + Sprint Status */}
        {(showPriorityChange || showSprintStatus) && (
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <div className="flex gap-4 flex-wrap">
              {showPriorityChange && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                  <select
                    value={ticket.priority}
                    onChange={e => handlePriorityChange(e.target.value as Priority)}
                    disabled={actionLoading}
                    className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={Priority.LOW}>Low</option>
                    <option value={Priority.MEDIUM}>Medium</option>
                    <option value={Priority.HIGH}>High</option>
                    <option value={Priority.CRITICAL}>Critical</option>
                  </select>
                </div>
              )}
              {showSprintStatus && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Sprint Status</label>
                  <select
                    value={ticket.sprint_status || ''}
                    onChange={e => handleSprintStatusChange(e.target.value as SprintStatus)}
                    disabled={actionLoading}
                    className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="" disabled>Select...</option>
                    <option value={SprintStatus.IN_SPRINT}>In Sprint</option>
                    <option value={SprintStatus.NEXT_SPRINT}>Next Sprint</option>
                    <option value={SprintStatus.AWAITED}>Awaited</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Action Bar */}
        {(availableTransitions.length > 0 || showPostUpdate || showRevert) && (
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Actions</h3>

            {/* Comment input */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add a comment (required for actions)..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-600 mb-3"
            />

            {/* Hold date picker */}
            {availableTransitions.includes(TicketStatus.ON_HOLD_UNTIL) && (
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">Hold Until Date</label>
                <input
                  type="date"
                  value={holdDate}
                  onChange={e => setHoldDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              {availableTransitions.map(status => {
                const btn = TRANSITION_BUTTON_LABELS[status] || { label: status, color: 'bg-green-600 hover:bg-green-700' };
                return (
                  <button
                    key={status}
                    onClick={() => handleTransition(status)}
                    disabled={actionLoading}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50 ${btn.color}`}
                  >
                    {btn.label}
                  </button>
                );
              })}
              {showPostUpdate && (
                <button
                  onClick={handlePostUpdate}
                  disabled={actionLoading}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Post Weekly Update
                </button>
              )}
              {showRevert && (
                <button
                  onClick={handleRevert}
                  disabled={actionLoading}
                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  ↩ Revert Last Action
                </button>
              )}
            </div>
          </div>
        )}

        {/* Section 4: Timeline Feed */}
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

  // A reopen lands on NEW_ESCALATION — label it "Reopened" so the timeline reads correctly
  const isReopenEntry =
    log.new_status === TicketStatus.NEW_ESCALATION &&
    (log.previous_status === TicketStatus.RESOLVED || log.previous_status === TicketStatus.RESOLVED_BY_CS);

  const newStatusLabel = isReopenEntry ? 'Reopened' : STATUS_LABELS[log.new_status as TicketStatus];
  const newStatusColor = isReopenEntry ? 'bg-red-100 text-red-700' : STATUS_COLORS[log.new_status as TicketStatus];

  return (
    <div className="relative pl-6 pb-4 border-l-2 border-gray-200 last:border-l-0">
      <div className="absolute left-[-5px] top-1 w-2 h-2 bg-blue-600 rounded-full"></div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
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
          <span className={`px-1.5 py-0.5 rounded ${newStatusColor}`}>
            {newStatusLabel}
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
