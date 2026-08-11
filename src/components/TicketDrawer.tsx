import { useState, useEffect } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Ticket, UpdateLog, TicketStatus, UserRole, Priority, SprintStatus,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, SPRINT_STATUS_LABELS, SPRINT_STATUS_COLORS,
  ROLE_LABELS, ROLE_BADGE_COLORS,
  getStatusLabel, getStatusColor, isReopenedPending, REOPENED_LABEL, REOPENED_COLOR,
  PRODUCT_ROLES
} from '../types';
import { useAuth } from '../hooks/useAuth';
import { useTicketLogs, useAllUsers } from '../hooks/useTickets';
import { getAvailableTransitions, canPostUpdate, canChangePriority, canChangeSprintStatus, canRevertLastAction, canChangeAssignee } from '../lib/stateMachine';
import { transitionTicket, postProgressUpdate, changePriority, changeSprintStatus, changeAssignee, revertLastAction, addComment, batchSave, BatchAction } from '../lib/actions';
import { extractJiraKey, getJiraUrl } from '../lib/jiraUtils';

interface TicketDrawerProps {
  ticket: Ticket | null;
  onClose: () => void;
  onUpdate: () => void;
}

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

const TRANSITION_BUTTON_LABELS: Record<string, { label: string; color: string }> = {
  RESOLVED_BY_CS: { label: 'Solve Internally', color: 'bg-emerald-600 hover:bg-emerald-700' },
  PENDING_PROD_REVIEW: { label: 'Escalate to Product', color: 'bg-purple-600 hover:bg-purple-700' },
  IN_PRODUCT_SCOPE: { label: 'Accept into Scope', color: 'bg-blue-600 hover:bg-blue-700' },
  IN_PROGRESS: { label: 'Move to In Progress', color: 'bg-indigo-600 hover:bg-indigo-700' },
  ON_HOLD_UNTIL: { label: 'Put on Hold', color: 'bg-orange-500 hover:bg-orange-600' },
  RESOLVED: { label: 'Mark Resolved', color: 'bg-green-600 hover:bg-green-700' },
  CLOSED: { label: 'Close Ticket', color: 'bg-gray-700 hover:bg-gray-800' },
  NEW_ESCALATION: { label: 'Reopen', color: 'bg-red-500 hover:bg-red-600' },
  RETURNED_TO_CS: { label: 'Send back to CS Lead', color: 'bg-amber-600 hover:bg-amber-700' },
};

export function TicketDrawer({ ticket, onClose, onUpdate }: TicketDrawerProps) {
  const { appUser } = useAuth();
  const { logs, loading: logsLoading, refetch: refetchLogs } = useTicketLogs(ticket?.id || null);
  const allUsers = useAllUsers();

  const [comment, setComment] = useState('');
  const [holdDate, setHoldDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // Batch mode state
  const [pendingActions, setPendingActions] = useState<BatchAction[]>([]);
  const [pendingPriority, setPendingPriority] = useState<Priority | null>(null);
  const [pendingSprint, setPendingSprint] = useState<SprintStatus | null>(null);
  const [pendingAssignee, setPendingAssignee] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<TicketStatus | null>(null);

  // Reset pending state when ticket changes
  useEffect(() => {
    setPendingActions([]);
    setPendingPriority(null);
    setPendingSprint(null);
    setPendingAssignee(null);
    setPendingTransition(null);
    setComment('');
    setHoldDate('');
    setError('');
  }, [ticket?.id]);

  if (!ticket || !appUser) return null;

  const userRole = appUser.role as UserRole;
  const userId = appUser!.id;
  const reporterId = ticket!.reporter_id;

  const availableTransitions = getAvailableTransitions(ticket!.status as TicketStatus, userRole, userId, reporterId);
  const showPostUpdate = canPostUpdate(ticket!.status as TicketStatus, userRole);
  const showPriorityChange = canChangePriority(userRole, ticket!.sprint_status);
  const showSprintStatus = canChangeSprintStatus(ticket!.status as TicketStatus, userRole);
  const showRevert = canRevertLastAction(userRole);
  const showAssignee = canChangeAssignee(userRole);

  const productUsers = allUsers.filter(u => PRODUCT_ROLES.includes(u.role as UserRole));
  const hasPendingChanges = pendingActions.length > 0 || pendingPriority || pendingSprint || pendingAssignee || pendingTransition;

  // Queue a priority change
  function queuePriority(newPriority: Priority) {
    if (newPriority === ticket!.priority && !pendingPriority) return;
    setPendingPriority(newPriority);
    setPendingActions(prev => [...prev.filter(a => a.type !== 'priority'), { type: 'priority', payload: { newPriority } }]);
  }

  // Queue a sprint status change
  function queueSprint(newSprint: SprintStatus) {
    setPendingSprint(newSprint);
    setPendingActions(prev => [...prev.filter(a => a.type !== 'sprint_status'), { type: 'sprint_status', payload: { newSprintStatus: newSprint } }]);
  }

  // Queue an assignee change
  function queueAssignee(newAssigneeId: string) {
    const assigneeUser = allUsers.find(u => u.id === newAssigneeId);
    setPendingAssignee(newAssigneeId);
    setPendingActions(prev => [...prev.filter(a => a.type !== 'assignee'), { type: 'assignee', payload: { newAssigneeId, newAssigneeName: assigneeUser?.full_name || '' } }]);
  }

  // Queue a transition
  function queueTransition(newStatus: TicketStatus) {
    if (newStatus === TicketStatus.ON_HOLD_UNTIL && !holdDate) {
      setError('Please select a hold-until date.');
      return;
    }
    setPendingTransition(newStatus);
    setPendingActions(prev => [...prev.filter(a => a.type !== 'transition'), { type: 'transition', payload: { newStatus } }]);
  }

  // Save all pending changes at once
  async function handleBatchSave() {
    if (pendingTransition && !comment.trim()) {
      setError('Comment is required when changing status.');
      return;
    }

    setActionLoading(true);
    setError('');
    try {
      await batchSave({
        ticketId: ticket!.id,
        currentStatus: ticket!.status as TicketStatus,
        userId: appUser!.id,
        userRole,
        reporterId: ticket!.reporter_id,
        comment: comment.trim(),
        actions: pendingActions,
        holdUntilDate: pendingTransition === TicketStatus.ON_HOLD_UNTIL ? new Date(holdDate).toISOString() : undefined,
      });
      setComment('');
      setHoldDate('');
      setPendingActions([]);
      setPendingPriority(null);
      setPendingSprint(null);
      setPendingAssignee(null);
      setPendingTransition(null);
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Save failed'));
    }
    setActionLoading(false);
  }

  // Standalone comment (no action)
  async function handleAddComment() {
    if (!comment.trim()) {
      setError('Please enter a comment.');
      return;
    }
    setActionLoading(true);
    setError('');
    try {
      await addComment({
        ticketId: ticket!.id,
        currentStatus: ticket!.status as TicketStatus,
        userId: appUser!.id,
        comment: comment.trim(),
      });
      setComment('');
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Failed to add comment'));
    }
    setActionLoading(false);
  }

  // Post progress update (resets SLA timer)
  async function handlePostUpdate() {
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
        comment: comment.trim(),
      });
      setComment('');
      await refetchLogs();
      onUpdate();
    } catch (err: unknown) {
      setError(describeError(err, 'Action failed'));
    }
    setActionLoading(false);
  }

  // Revert
  async function handleRevert() {
    setActionLoading(true);
    setError('');
    try {
      await revertLastAction({
        ticketId: ticket!.id,
        userId: appUser!.id,
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
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[pendingPriority || ticket!.priority as Priority]}`}>
              {pendingPriority || ticket!.priority}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(ticket)}`}>
              {getStatusLabel(ticket)}
            </span>
            {ticket.is_reopened && !isReopenedPending(ticket) && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${REOPENED_COLOR}`}>
                {REOPENED_LABEL}
              </span>
            )}
            {(pendingSprint || ticket!.sprint_status) && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${SPRINT_STATUS_COLORS[(pendingSprint || ticket!.sprint_status) as SprintStatus]}`}>
                {SPRINT_STATUS_LABELS[(pendingSprint || ticket!.sprint_status) as SprintStatus]}
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
            <div><span className="font-medium">Assignee:</span> {
              ticket.assignee_id
                ? (allUsers.find(u => u.id === ticket.assignee_id)?.full_name || 'Unassigned')
                : 'Unassigned'
            }</div>
            <div>
              <span className="font-medium">JIRA:</span>{' '}
              {ticket.freshdesk_id ? (
                <a href={getJiraUrl(ticket.freshdesk_id)!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline">
                  {extractJiraKey(ticket.freshdesk_id) || 'Open Ticket'} ↗
                </a>
              ) : '—'}
            </div>
            <div><span className="font-medium">Created:</span> {format(new Date(ticket.created_at), 'dd MMM yyyy, HH:mm')}</div>
            <div><span className="font-medium">Updated:</span> {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}</div>
            {ticket.jira_status && (
              <div><span className="font-medium">JIRA Status:</span> <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{ticket.jira_status}</span></div>
            )}
            {ticket.hold_until_date && (
              <div className="col-span-2">
                <span className="font-medium">On Hold Until:</span> {format(new Date(ticket.hold_until_date), 'dd MMM yyyy')}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Quick Controls (Priority, Sprint, Assignee) */}
        {(showPriorityChange || showSprintStatus || showAssignee) && (
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <div className="flex gap-4 flex-wrap">
              {showPriorityChange && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                  <select
                    value={pendingPriority || ticket!.priority}
                    onChange={e => queuePriority(e.target.value as Priority)}
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
                    value={pendingSprint || ticket!.sprint_status || ''}
                    onChange={e => queueSprint(e.target.value as SprintStatus)}
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
              {showAssignee && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
                  <select
                    value={pendingAssignee || ticket.assignee_id || ''}
                    onChange={e => queueAssignee(e.target.value)}
                    disabled={actionLoading}
                    className="px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {productUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Actions */}
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Actions</h3>

          {/* Comment input */}
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment or note..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
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

          {/* Pending changes indicator */}
          {hasPendingChanges && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded-md text-xs mb-3">
              <span className="font-medium">Unsaved changes:</span>{' '}
              {pendingTransition && <span className="mr-2">Status → {STATUS_LABELS[pendingTransition]}</span>}
              {pendingPriority && <span className="mr-2">Priority → {pendingPriority}</span>}
              {pendingSprint && <span className="mr-2">Sprint → {SPRINT_STATUS_LABELS[pendingSprint]}</span>}
              {pendingAssignee && <span className="mr-2">Assignee changed</span>}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mb-3">
            {/* Status transitions */}
            {availableTransitions.map(status => {
              const btn = TRANSITION_BUTTON_LABELS[status] || { label: status, color: 'bg-blue-600 hover:bg-blue-700' };
              const isQueued = pendingTransition === status;
              return (
                <button
                  key={status}
                  onClick={() => queueTransition(status)}
                  disabled={actionLoading}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50 ${btn.color} ${isQueued ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
                >
                  {btn.label}
                </button>
              );
            })}

            {/* Post weekly update */}
            {showPostUpdate && (
              <button
                onClick={handlePostUpdate}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                Post Weekly Update
              </button>
            )}

            {/* Revert */}
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

          {/* Save + Comment buttons */}
          <div className="flex gap-2">
            {hasPendingChanges && (
              <button
                onClick={handleBatchSave}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Saving...' : 'Save All Changes'}
              </button>
            )}
            {!hasPendingChanges && (
              <button
                onClick={handleAddComment}
                disabled={actionLoading || !comment.trim()}
                className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                Add Comment
              </button>
            )}
          </div>
        </div>

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
        <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_BADGE_COLORS[(log.author?.role as UserRole) || UserRole.CS_MANAGER]}`}>
          {ROLE_LABELS[(log.author?.role as UserRole) || UserRole.CS_MANAGER]}
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
