import { supabase } from './supabase';
import { TicketStatus, TicketSubType, Priority, SprintStatus, UserRole } from '../types';
import { canTransition, canPostUpdate, canChangePriority, canChangeSprintStatus, canRevertLastAction, canChangeAssignee, isReopenTransition } from './stateMachine';

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
      freshdesk_id: params.freshdesk_id || null,
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
  comment: string;
}

export async function addComment(params: AddCommentParams) {
  const { ticketId, currentStatus, userId, comment } = params;

  if (!comment.trim()) {
    throw new Error('Comment cannot be empty.');
  }

  // Update latest_comment on ticket
  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ latest_comment: comment.trim() })
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

  // Update latest_comment if provided
  if (comment.trim()) {
    ticketUpdate.latest_comment = comment.trim();
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
  const auditComment = buildAuditComment(actions, comment, params);
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

function buildAuditComment(actions: BatchAction[], comment: string, params: BatchSaveParams): string {
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
