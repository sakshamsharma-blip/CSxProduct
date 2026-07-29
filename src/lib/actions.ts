import { supabase } from './supabase';
import { TicketStatus, TicketSubType, Priority, SprintStatus, UserRole } from '../types';
import { canTransition, canPostUpdate, canChangePriority, canChangeSprintStatus, canRevertLastAction, isReopenTransition } from './stateMachine';

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

  // Validate transition
  if (!canTransition(currentStatus, newStatus, userRole, userId, reporterId)) {
    throw new Error(`Transition from ${currentStatus} to ${newStatus} is not allowed.`);
  }

  if (!comment.trim()) {
    throw new Error('Comment is required for status transitions.');
  }

  // Build ticket update
  const ticketUpdate: Record<string, unknown> = {
    status: newStatus,
  };

  // Handle hold date
  if (newStatus === TicketStatus.ON_HOLD_UNTIL) {
    if (!holdUntilDate) throw new Error('Hold until date is required.');
    ticketUpdate.hold_until_date = holdUntilDate;
  } else {
    ticketUpdate.hold_until_date = null;
  }

  // If product lead is taking action, update the product activity timestamp
  if (userRole === UserRole.PRODUCT_LEAD) {
    ticketUpdate.last_product_activity_at = new Date().toISOString();
  }

  // Handle reopen — read current count and increment
  if (isReopenTransition(currentStatus, newStatus)) {
    const { data: current } = await supabase
      .from('tickets')
      .select('reopen_count')
      .eq('id', ticketId)
      .single();

    ticketUpdate.is_reopened = true;
    ticketUpdate.reopen_count = (current?.reopen_count ?? 0) + 1;
  }

  // Clear sprint status if leaving IN_PRODUCT_SCOPE
  if (currentStatus === TicketStatus.IN_PRODUCT_SCOPE && newStatus !== TicketStatus.IN_PRODUCT_SCOPE) {
    ticketUpdate.sprint_status = null;
  }

  // Update ticket
  const { error: ticketError } = await supabase
    .from('tickets')
    .update(ticketUpdate)
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  // Create audit log entry
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
    throw new Error('Progress updates can only be posted by Product Lead on In Product Scope tickets.');
  }

  if (!comment.trim()) {
    throw new Error('Comment is required for progress updates.');
  }

  // Update last_product_activity_at (resets SLA timer)
  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ last_product_activity_at: new Date().toISOString() })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  // Create audit log (same status → same status = progress update)
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
  oldPriority: Priority;
  newPriority: Priority;
  userId: string;
  userRole: UserRole;
}

export async function changePriority(params: ChangePriorityParams) {
  const { ticketId, currentStatus, oldPriority, newPriority, userId, userRole } = params;

  if (!canChangePriority(userRole)) {
    throw new Error('Only CS Lead and Product Lead can change priority.');
  }

  if (oldPriority === newPriority) return;

  // Update priority on ticket
  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ priority: newPriority })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  // Log audit entry
  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: `Priority changed from ${oldPriority} to ${newPriority}`,
      previous_status: currentStatus,
      new_status: currentStatus, // No status change
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
    throw new Error('Sprint status can only be changed by Product Lead on In Product Scope tickets.');
  }

  // Update sprint status on ticket
  const { error: ticketError } = await supabase
    .from('tickets')
    .update({ sprint_status: newSprintStatus })
    .eq('id', ticketId);

  if (ticketError) throw ticketError;

  // Log audit entry
  const { error: logError } = await supabase
    .from('update_logs')
    .insert([{
      ticket_id: ticketId,
      author_id: userId,
      comment: `Sprint status set to ${newSprintStatus.replace('_', ' ')}`,
      previous_status: currentStatus,
      new_status: currentStatus, // No status change
      hold_target_date: null,
    }]);

  if (logError) throw logError;
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
    throw new Error('Only CS Lead and Product Lead can revert actions.');
  }

  // Fetch recent logs for this ticket, then find the last real status change in JS.
  // (Supabase filters can't compare two columns, so this must be done client-side.)
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

  const revertToStatus = lastStatusChange.previous_status as TicketStatus;
  const revertFromStatus = lastStatusChange.new_status as TicketStatus;

  // Revert ticket status
  const ticketUpdate: Record<string, unknown> = {
    status: revertToStatus,
  };

  // Restore the hold date when reverting back into ON_HOLD, otherwise clear it
  if (revertToStatus === TicketStatus.ON_HOLD_UNTIL) {
    // Find the log that originally set this hold date
    const holdLog = logs?.find(
      log => log.new_status === TicketStatus.ON_HOLD_UNTIL && log.hold_target_date
    );
    ticketUpdate.hold_until_date = holdLog?.hold_target_date ?? lastStatusChange.hold_target_date ?? null;
  } else {
    ticketUpdate.hold_until_date = null;
  }

  // If we're undoing a reopen, roll the reopen counter back
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

  // Add audit entry for the revert
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
