// ===== User Roles =====
export enum UserRole {
  CS_MANAGER = 'CS_MANAGER',
  CS_LEAD = 'CS_LEAD',
  PRODUCT_LEAD = 'PRODUCT_LEAD',
}

// ===== Ticket Status States =====
export enum TicketStatus {
  NEW_ESCALATION = 'NEW_ESCALATION',
  RESOLVED_BY_CS = 'RESOLVED_BY_CS',
  PENDING_PROD_REVIEW = 'PENDING_PROD_REVIEW',
  IN_PRODUCT_SCOPE = 'IN_PRODUCT_SCOPE',
  ON_HOLD_UNTIL = 'ON_HOLD_UNTIL',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

// ===== Ticket Sub-Types =====
export enum TicketSubType {
  BUG = 'BUG',
  ENHANCEMENT = 'ENHANCEMENT',
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  BACKEND_CONFIG = 'BACKEND_CONFIG',
}

// ===== Priority Levels =====
export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// ===== Sprint Status (only for IN_PRODUCT_SCOPE tickets) =====
export enum SprintStatus {
  IN_SPRINT = 'IN_SPRINT',
  NEXT_SPRINT = 'NEXT_SPRINT',
  AWAITED = 'AWAITED',
}

// ===== Data Entities =====
export interface AppUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface Ticket {
  id: string;
  custom_id: string; // REQ-1001
  lab_name: string;
  client_id: string;
  subject: string;
  description: string;
  sub_type: TicketSubType;
  priority: Priority;
  status: TicketStatus;
  sprint_status: SprintStatus | null;
  freshdesk_id: string | null;
  hold_until_date: string | null;
  last_product_activity_at: string;
  is_reopened: boolean;
  reopen_count: number;
  reporter_id: string;
  reporter?: AppUser;
  created_at: string;
  updated_at: string;
}

export interface UpdateLog {
  id: string;
  ticket_id: string;
  author_id: string;
  author?: AppUser;
  comment: string;
  previous_status: TicketStatus;
  new_status: TicketStatus;
  hold_target_date: string | null;
  created_at: string;
}

// ===== UI Helpers =====
export type QueueTab =
  | 'all'
  | 'my_tickets'
  | 'pending_cs'
  | 'pending_product'
  | 'in_scope'
  | 'on_hold'
  | 'resolved'
  | 'closed';

export type SortField = 'priority' | 'created_at' | 'updated_at' | 'status' | 'lab_name' | 'client_id' | 'days_since';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface FilterConfig {
  priority: Priority | 'ALL';
  subType: TicketSubType | 'ALL';
  status: TicketStatus | 'ALL' | 'REOPENED';
}

// ===== Display Constants =====
export const STATUS_LABELS: Record<TicketStatus, string> = {
  [TicketStatus.NEW_ESCALATION]: 'New Escalation',
  [TicketStatus.RESOLVED_BY_CS]: 'Resolved by CS',
  [TicketStatus.PENDING_PROD_REVIEW]: 'Pending Product Review',
  [TicketStatus.IN_PRODUCT_SCOPE]: 'In Product Scope',
  [TicketStatus.ON_HOLD_UNTIL]: 'On Hold',
  [TicketStatus.RESOLVED]: 'Resolved',
  [TicketStatus.CLOSED]: 'Closed',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  [Priority.LOW]: 'bg-gray-100 text-gray-700',
  [Priority.MEDIUM]: 'bg-blue-100 text-blue-700',
  [Priority.HIGH]: 'bg-orange-100 text-orange-700',
  [Priority.CRITICAL]: 'bg-red-100 text-red-700',
};

export const STATUS_COLORS: Record<TicketStatus, string> = {
  [TicketStatus.NEW_ESCALATION]: 'bg-yellow-100 text-yellow-800',
  [TicketStatus.RESOLVED_BY_CS]: 'bg-emerald-100 text-emerald-800',
  [TicketStatus.PENDING_PROD_REVIEW]: 'bg-purple-100 text-purple-800',
  [TicketStatus.IN_PRODUCT_SCOPE]: 'bg-blue-100 text-blue-800',
  [TicketStatus.ON_HOLD_UNTIL]: 'bg-orange-100 text-orange-800',
  [TicketStatus.RESOLVED]: 'bg-green-100 text-green-800',
  [TicketStatus.CLOSED]: 'bg-gray-200 text-gray-700',
};

export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  [SprintStatus.IN_SPRINT]: 'In Sprint',
  [SprintStatus.NEXT_SPRINT]: 'Next Sprint',
  [SprintStatus.AWAITED]: 'Awaited',
};

export const SPRINT_STATUS_COLORS: Record<SprintStatus, string> = {
  [SprintStatus.IN_SPRINT]: 'bg-green-100 text-green-800',
  [SprintStatus.NEXT_SPRINT]: 'bg-blue-100 text-blue-800',
  [SprintStatus.AWAITED]: 'bg-gray-100 text-gray-600',
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  [Priority.CRITICAL]: 0,
  [Priority.HIGH]: 1,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 3,
};

// ===== Status Display Helpers =====
// A reopened ticket sits in NEW_ESCALATION for workflow purposes, but we surface it
// as "Reopened" so CS Lead / Product Lead can spot it and prioritise accordingly.

export const REOPENED_LABEL = 'Reopened';
export const REOPENED_COLOR = 'bg-rose-100 text-rose-800 ring-1 ring-rose-300';

type StatusDisplaySource = Pick<Ticket, 'status' | 'is_reopened'>;

export function isReopenedPending(ticket: StatusDisplaySource): boolean {
  return Boolean(ticket.is_reopened) && ticket.status === TicketStatus.NEW_ESCALATION;
}

export function getStatusLabel(ticket: StatusDisplaySource): string {
  return isReopenedPending(ticket)
    ? REOPENED_LABEL
    : STATUS_LABELS[ticket.status as TicketStatus];
}

export function getStatusColor(ticket: StatusDisplaySource): string {
  return isReopenedPending(ticket)
    ? REOPENED_COLOR
    : STATUS_COLORS[ticket.status as TicketStatus];
}
