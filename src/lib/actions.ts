import { supabase } from './supabase';
import { TicketStatus, TicketSubType, Priority, SprintStatus, UserRole } from '../types';
import { canTransition, canPostUpdate, canChangePriority, canChangeSprintStatus, canRevertLastAction, canChangeAssignee, isReopenTransition, canLinkJira } from './stateMachine';
import { normalizeJiraInput, extractJiraKey } from './jiraUtils';

// ===== CREATE TICKET =====

interface CreateTicketParams {
  lab_name: string;
  client_id: string;
  subject: string;
  description: string;
  sub_type: TicketSubType;
  priority: Priority;
  freshdesk_id?: string;
  reporter_id: string;
}

export async function createTicket(params: CreateTicketParams) {
  const { data, error } = await supabase
    .from('tickets')
    .insert([{
      lab_name: params.lab_name,
      client_id: params.client_id,
      subject: params.subject,
      description: params.description,
      sub_type: params.sub_type,
      priority: params.priority,
      freshdesk_id: normalizeJiraInput(params.freshdesk_id) || null,
      reporter_id: params.reporter_id,
      status: TicketStatus.NEW_ESCALATION,
      last_product_activity_at: new Date().toISOString(),
    }])
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// ===== TRANSITION TICKET STATUS =====

interface TransitionParams {
  ticketId: string;
  currentStatus: TicketStatus;
  newStatus: TicketStatus;
  userId: string;
  userRole: UserRole;
  reporterId: string;
  comment: string;
  holdUntilDate?: string;
}

export async function transitionTicket(params: TransitionParams) {
  const { ticketId, currentStatus, newStatus, userId, userRole, reporterId, comment, holdUntilDate } = params;

  if (!canTransition(currentStatus, newStatus, userRole, userId, reporterId)) {
    throw new Error(`Transition from ${currentStatus} to ${newStatus} is not allowed.`);
  }

  if (!comment.trim()) {
    throw new Error('Comment is required for status transitions.');
  }

  const ticketUpdate: Record<string, unknown> = {
    status: newStatus,
  };

  if (newStatus === TicketStatus.ON_HOLD_UNTIL) {
    if (!holdUntilDate) throw new Error('Hold until date is required.');
    ticketUpdate.hold_until_date = holdUntilDate;
  } else {
    ticketUpdate.hold_until_date = null;
  }

  // Update product activity timestamp for product-side actions
  const productStatuses = [TicketStatus.IN_PRODUCT_SCOPE, TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.ON_HOLD_UNTIL];
  if (productStatuses.includes(newStatus)) {
    ticketUpdate.last_product_activity_at = new Date().toISOString();
  }

  // Handle reopen
  if (isReopenTransition(currentStatus, newStatus)) {
    const { data: current } = await supabase
      .from('tickets')
      .select('reopen_count')
      .eq('id', ticketId)
      .single();

    ticketUpdate.is_reopened = true;
    ticketUpdate.reopen_count = (current?.reopen_count ?? 0) + 1;
  }

  // Clear sprint status if leaving product pipeline to non-product status
  const nonProductStatuses = [TicketStatus.RETURNED_TO_CS, TicketStatus.CLOSED, TicketStatus.NEW_ESCALATION];
  if (nonProductStatuses.includes(newStatus)) {
    ticketUpdate.sprint_status = null;
  }

  // Update latest_comment
  ticketUpdate.latest_comment = comment.trim();

  const { error: ticketError } = await supabase
    .from('tickets')
    .update(ticketUpdate)
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: comment.trim(),
      previous_status: currentStatus,
      new_status: newStatus,
      hold_target_date: holdUntilDate || null,
    }]);

  if (logError) throw logError;
}

// ===== POST PROGRESS UPDATE (no status change) =====

interface PostUpdateParams {
  ticketId: string;
  currentStatus: TicketStatus;
  userId: string;
  userRole: UserRole;
  comment: string;
}

export async function postProgressUpdate(params: PostUpdateParams) {
  const { ticketId, currentStatus, userId, userRole, comment } = params;

  if (!canPostUpdate(currentStatus, userRole)) {
    throw new Error('Progress updates can only be posted on In Product Scope or In Progress tickets by authorized roles.');
  }

  if (!comment.trim()) {
    throw new Error('Comment is required for progress updates.');
  }

  const { error: ticketError } = await supabase
    .from('tickets')
    .update({
      last_product_activity_at: new Date().toISOString(),
      latest_comment: comment.trim(),
    })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: comment.trim(),
      previous_status: currentStatus,
      new_status: currentStatus,
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}

// ===== ADD STANDALONE COMMENT (anyone, anytime, no action required) =====

interface AddCommentParams {
  ticketId: string;
  currentStatus: TicketStatus;
  userId: string;
  userRole: UserRole;
  comment: string;
}

/** True when a comment from this role on a ticket in this stage counts as the weekly update. */
export function commentCountsAsUpdate(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return canPostUpdate(currentStatus, userRole);
}

export async function addComment(params: AddCommentParams) {
  const { ticketId, currentStatus, userId, userRole, comment } = params;

  if (!comment.trim()) {
    throw new Error('Comment cannot be empty.');
  }

  // Update latest_comment on ticket. On product-stage tickets a comment from an
  // action role also counts as the weekly update (resets the 7-day clock), so
  // people don't have to remember a separate "Post Weekly Update" button.
  const ticketUpdate: Record<string, unknown> = { latest_comment: comment.trim() };
  if (commentCountsAsUpdate(currentStatus, userRole)) {
    ticketUpdate.last_product_activity_at = new Date().toISOString();
  }
  const { error: ticketError } = await supabase
    .from('tickets')
    .update(ticketUpdate)
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  // Add to audit trail (same status → same status = comment only)
  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: comment.trim(),
      previous_status: currentStatus,
      new_status: currentStatus,
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}

// ===== CHANGE PRIORITY =====

interface ChangePriorityParams {
  ticketId: string;
  currentStatus: TicketStatus;
  sprintStatus: string | null;
  oldPriority: Priority;
  newPriority: Priority;
  userId: string;
  userRole: UserRole;
}

export async function changePriority(params: ChangePriorityParams) {
  const { ticketId, currentStatus, sprintStatus, oldPriority, newPriority, userId, userRole } = params;

  if (!canChangePriority(userRole, sprintStatus)) {
    throw new Error('Cannot change priority on in-sprint tickets.');
  }

  if (oldPriority === newPriority) return;

  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ priority: newPriority })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: `Priority changed from ${oldPriority} to ${newPriority}`,
      previous_status: currentStatus,
      new_status: currentStatus,
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}

// ===== CHANGE SPRINT STATUS =====

interface ChangeSprintStatusParams {
  ticketId: string;
  currentStatus: TicketStatus;
  newSprintStatus: SprintStatus;
  userId: string;
  userRole: UserRole;
}

export async function changeSprintStatus(params: ChangeSprintStatusParams) {
  const { ticketId, currentStatus, newSprintStatus, userId, userRole } = params;

  if (!canChangeSprintStatus(currentStatus, userRole)) {
    throw new Error('Sprint status can only be changed on eligible tickets by authorized roles.');
  }

  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ sprint_status: newSprintStatus })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: `Sprint status set to ${newSprintStatus.replace('_', ' ')}`,
      previous_status: currentStatus,
      new_status: currentStatus,
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}

// ===== CHANGE ASSIGNEE =====

interface ChangeAssigneeParams {
  ticketId: string;
  currentStatus: TicketStatus;
  newAssigneeId: string;
  newAssigneeName: string;
  userId: string;
  userRole: UserRole;
}

export async function changeAssignee(params: ChangeAssigneeParams) {
  const { ticketId, currentStatus, newAssigneeId, newAssigneeName, userId, userRole } = params;

  if (!canChangeAssignee(userRole)) {
    throw new Error('Only Product Lead and Product Team can assign tickets.');
  }

  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ assignee_id: newAssigneeId })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: `Assigned to ${newAssigneeName}`,
      previous_status: currentStatus,
      new_status: currentStatus,
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}

// ===== BATCH SAVE (multiple changes at once, single timestamp) =====

export interface BatchAction {
  type: 'transition' | 'priority' | 'sprint_status' | 'assignee';
  payload: Record<string, unknown>;
}

interface BatchSaveParams {
  ticketId: string;
  currentStatus: TicketStatus;
  userId: string;
  userRole: UserRole;
  reporterId: string;
  comment: string;
  actions: BatchAction[];
  holdUntilDate?: string;
}

export async function batchSave(params: BatchSaveParams) {
  const { ticketId, currentStatus, userId, userRole, reporterId, comment, actions, holdUntilDate } = params;

  if (!comment.trim() && actions.some(a => a.type === 'transition')) {
    throw new Error('Comment is required when changing status.');
  }

  const ticketUpdate: Record<string, unknown> = {};
  const logEntries: Array<{
    ticket_id: string;
    author_id: string;
    comment: string;
    previous_status: TicketStatus;
    new_status: TicketStatus;
    hold_target_date: string | null;
  }> = [];

  let finalStatus = currentStatus;

  for (const action of actions) {
    switch (action.type) {
      case 'transition': {
        const newStatus = action.payload.newStatus as TicketStatus;
        if (!canTransition(currentStatus, newStatus, userRole, userId, reporterId)) {
          throw new Error(`Transition to ${newStatus} is not allowed.`);
        }
        ticketUpdate.status = newStatus;
        finalStatus = newStatus;

        if (newStatus === TicketStatus.ON_HOLD_UNTIL) {
          if (!holdUntilDate) throw new Error('Hold until date is required.');
          ticketUpdate.hold_until_date = holdUntilDate;
        } else {
          ticketUpdate.hold_until_date = null;
        }

        const productStatuses = [TicketStatus.IN_PRODUCT_SCOPE, TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.ON_HOLD_UNTIL];
        if (productStatuses.includes(newStatus)) {
          ticketUpdate.last_product_activity_at = new Date().toISOString();
        }

        if (isReopenTransition(currentStatus, newStatus)) {
          const { data: current } = await supabase
            .from('tickets').select('reopen_count').eq('id', ticketId).single();
          ticketUpdate.is_reopened = true;
          ticketUpdate.reopen_count = (current?.reopen_count ?? 0) + 1;
        }

        const nonProductStatuses = [TicketStatus.RETURNED_TO_CS, TicketStatus.CLOSED, TicketStatus.NEW_ESCALATION];
        if (nonProductStatuses.includes(newStatus)) {
          ticketUpdate.sprint_status = null;
        }
        break;
      }
      case 'priority': {
        const newPriority = action.payload.newPriority as Priority;
        ticketUpdate.priority = newPriority;
        break;
      }
      case 'sprint_status': {
        const newSprint = action.payload.newSprintStatus as SprintStatus;
        ticketUpdate.sprint_status = newSprint;
        break;
      }
      case 'assignee': {
        const newAssigneeId = action.payload.newAssigneeId as string;
        ticketUpdate.assignee_id = newAssigneeId;
        break;
      }
    }
  }

  // Update latest_comment if provided; a note on a product-stage ticket counts as the weekly update
  if (comment.trim()) {
    ticketUpdate.latest_comment = comment.trim();
    if (commentCountsAsUpdate(currentStatus, userRole)) {
      ticketUpdate.last_product_activity_at = new Date().toISOString();
    }
  }

  // Apply all ticket changes in one update
  if (Object.keys(ticketUpdate).length > 0) {
    const { error: ticketError } = await supabase
      .from('tickets')
      .update(ticketUpdate)
      .eq('id', ticketId);

    if (ticketError) throw ticketError;
  }

  // Create a single audit log entry with all changes described in comment
  const auditComment = buildAuditComment(actions, comment);
  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: auditComment,
      previous_status: currentStatus,
      new_status: finalStatus,
      hold_target_date: holdUntilDate || null,
    }]);

  if (logError) throw logError;
}

function buildAuditComment(actions: BatchAction[], comment: string): string {
  const parts: string[] = [];

  for (const action of actions) {
    switch (action.type) {
      case 'priority':
        parts.push(`Priority → ${action.payload.newPriority}`);
        break;
      case 'sprint_status':
        parts.push(`Sprint → ${(action.payload.newSprintStatus as string).replace('_', ' ')}`);
        break;
      case 'assignee':
        parts.push(`Assigned to ${action.payload.newAssigneeName || 'team member'}`);
        break;
    }
  }

  if (comment.trim()) {
    parts.push(comment.trim());
  }

  return parts.join(' | ') || comment.trim() || 'Batch update';
}

// ===== REVERT LAST ACTION =====

interface RevertParams {
  ticketId: string;
  userId: string;
  userRole: UserRole;
}

export async function revertLastAction(params: RevertParams) {
  const { ticketId, userId, userRole } = params;

  if (!canRevertLastAction(userRole)) {
    throw new Error('Only authorized roles can revert actions.');
  }

  const { data: logs, error: fetchError } = await supabase
    .from('update_logs')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (fetchError) throw fetchError;

  const lastStatusChange = logs?.find(log => log.previous_status !== log.new_status);

  if (!lastStatusChange) {
    throw new Error('No status change found to revert.');
  }

  // Only the person who made the action can revert it (admin bypasses)
  if (userRole !== 'ADMIN' && lastStatusChange.author_id !== userId) {
    throw new Error('You can only revert your own actions.');
  }

  const revertToStatus = lastStatusChange.previous_status as TicketStatus;
  const revertFromStatus = lastStatusChange.new_status as TicketStatus;

  const ticketUpdate: Record<string, unknown> = {
    status: revertToStatus,
  };

  if (revertToStatus === TicketStatus.ON_HOLD_UNTIL) {
    const holdLog = logs?.find(
      log => log.new_status === TicketStatus.ON_HOLD_UNTIL && log.hold_target_date
    );
    ticketUpdate.hold_until_date = holdLog?.hold_target_date ?? null;
  } else {
    ticketUpdate.hold_until_date = null;
  }

  if (isReopenTransition(revertToStatus, revertFromStatus)) {
    const { data: current } = await supabase
      .from('tickets')
      .select('reopen_count')
      .eq('id', ticketId)
      .single();

    const newCount = Math.max((current?.reopen_count ?? 1) - 1, 0);
    ticketUpdate.reopen_count = newCount;
    ticketUpdate.is_reopened = newCount > 0;
  }

  const { error: ticketError } = await supabase
    .from('tickets')
    .update(ticketUpdate)
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: `Reverted: ${revertFromStatus} → ${revertToStatus}`,
      previous_status: revertFromStatus,
      new_status: revertToStatus,
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}

// ===== DUPLICATE CHECKS =====

export interface DuplicateMatch {
  id: string;
  custom_id: string;
  freshdesk_id: string | null;
  subject: string;
  status: TicketStatus;
  is_reopened: boolean;
  reason: 'same_jira' | 'same_subject';
}

/**
 * Tickets that look like the one being created or linked:
 *  - already linked to the same Jira key (any stage), or
 *  - same client ID and same subject, still open.
 */
export async function findPossibleDuplicates(opts: {
  jira?: string | null;
  clientId?: string;
  subject?: string;
  excludeTicketId?: string;
}): Promise<DuplicateMatch[]> {
  const cols = 'id, custom_id, freshdesk_id, subject, status, is_reopened, client_id';
  const out: DuplicateMatch[] = [];
  const key = extractJiraKey(normalizeJiraInput(opts.jira ?? null));

  if (key) {
    const { data } = await supabase.from('tickets').select(cols).ilike('freshdesk_id', `%${key}%`);
    for (const t of data ?? []) {
      if (extractJiraKey(t.freshdesk_id) === key && t.id !== opts.excludeTicketId) {
        out.push({ ...t, reason: 'same_jira' } as DuplicateMatch);
      }
    }
  }

  if (opts.clientId?.trim() && opts.subject?.trim()) {
    const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
    const { data } = await supabase.from('tickets').select(cols)
      .ilike('client_id', opts.clientId.trim())
      .neq('status', TicketStatus.CLOSED);
    for (const t of data ?? []) {
      if (norm(t.subject) === norm(opts.subject) && t.id !== opts.excludeTicketId && !out.some(o => o.id === t.id)) {
        out.push({ ...t, reason: 'same_subject' } as DuplicateMatch);
      }
    }
  }
  return out;
}

// ===== CHANGE JIRA LINK =====

interface ChangeJiraLinkParams {
  ticketId: string;
  currentStatus: TicketStatus;
  oldLink: string | null;
  newInput: string;
  userId: string;
  userRole: UserRole;
  reporterId: string;
}

/** Sets, replaces or removes (empty input) the Jira link and records old → new on the timeline. */
export async function changeJiraLink(params: ChangeJiraLinkParams) {
  const { ticketId, currentStatus, oldLink, newInput, userId, userRole, reporterId } = params;

  if (!canLinkJira(userRole, userId, reporterId)) {
    throw new Error('Only the ticket creator, CS Lead, Product or Admin can change the Jira link.');
  }

  const raw = newInput.trim();
  if (raw && !/^https?:\/\//i.test(raw) && !/^[A-Z][A-Z0-9]+-\d+$/i.test(raw)) {
    throw new Error(`"${raw}" isn't a Jira key (like EN-1234) or a link.`);
  }
  const link = raw ? normalizeJiraInput(raw) : null;
  if ((link ?? null) === (oldLink ?? null)) return;

  const { error: ticketError } = await supabase
    .from('tickets')
    .update({
      freshdesk_id: link,
      // The stored Jira status belonged to the old link; the next sync fills in the new one.
      jira_status: null,
      last_jira_status_change_at: null,
    })
    .eq('id', ticketId);
  if (ticketError) throw ticketError;

  const label = (v: string | null) => (v ? (extractJiraKey(v) ?? v) : 'none');
  const what = link
    ? (oldLink ? `Jira link changed: ${label(oldLink)} → ${label(link)}` : `Jira linked: ${label(link)}`)
    : `Jira link removed (was ${label(oldLink)})`;

  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: what,
      previous_status: currentStatus,
      new_status: currentStatus,
      hold_target_date: null,
    }]);
  if (logError) throw logError;

  // Fetch the new Jira ticket's status now instead of waiting for the 15-minute sync.
  if (link) await refreshJiraForTicket(ticketId);
}

/** Asks the server to re-read one ticket from Jira (best effort; the 15-minute sync covers failures). */
export async function refreshJiraForTicket(ticketId: string) {
  try {
    await supabase.functions.invoke('jira-sync-all', { body: { ticket_id: ticketId } });
  } catch {
    // Non-critical: the background sync will pick it up.
  }
}
