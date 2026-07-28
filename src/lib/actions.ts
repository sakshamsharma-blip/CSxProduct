import { supabase } from './supabase';
import { TicketStatus, TicketSubType, Priority } from '../types';
import { canTransition, canPostUpdate } from './stateMachine';
import { UserRole } from '../types';

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

interface TransitionParams {
  ticketId: string;
  currentStatus: TicketStatus;
  newStatus: TicketStatus;
  userId: string;
  userRole: UserRole;
  comment: string;
  holdUntilDate?: string;
}

export async function transitionTicket(params: TransitionParams) {
  const { ticketId, currentStatus, newStatus, userId, userRole, comment, holdUntilDate } = params;

  // Validate transition
  if (!canTransition(currentStatus, newStatus, userRole)) {
    throw new Error(`Transition from ${currentStatus} to ${newStatus} is not allowed for role ${userRole}`);
  }

  if (!comment.trim()) {
    throw new Error('Comment is required for status transitions');
  }

  // Build ticket update
  const ticketUpdate: Record<string, unknown> = {
    status: newStatus,
  };

  if (newStatus === TicketStatus.ON_HOLD_UNTIL) {
    if (!holdUntilDate) throw new Error('Hold until date is required');
    ticketUpdate.hold_until_date = holdUntilDate;
  } else {
    ticketUpdate.hold_until_date = null;
  }

  // If product lead is taking action, update the product activity timestamp
  if (userRole === UserRole.PRODUCT_LEAD) {
    ticketUpdate.last_product_activity_at = new Date().toISOString();
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
    throw new Error('Progress updates can only be posted by Product Lead on In Product Scope tickets');
  }

  if (!comment.trim()) {
    throw new Error('Comment is required for progress updates');
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
      new_status: currentStatus, // No status change
      hold_target_date: null,
    }]);

  if (logError) throw logError;
}
