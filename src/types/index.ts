// ===== User Roles =====
export enum UserRole {
  CS_MANAGER = 'CS_MANAGER',
  CS_LEAD = 'CS_LEAD',
  PRODUCT_LEAD = 'PRODUCT_LEAD',
  PRODUCT_TEAM = 'PRODUCT_TEAM',
  ADMIN = 'ADMIN',
}

// The single hardcoded admin email. No other account can be assigned ADMIN.
export const ADMIN_EMAIL = 'saksham.sharma@livehealth.in';

// Check if a role has admin-level access
export function isAdmin(role: UserRole, email?: string): boolean {
  return role === UserRole.ADMIN && email === ADMIN_EMAIL;
}

// Role groups for permission checks
export const LEAD_ROLES = [UserRole.CS_LEAD, UserRole.PRODUCT_LEAD, UserRole.PRODUCT_TEAM, UserRole.ADMIN];
export const PRODUCT_ROLES = [UserRole.PRODUCT_LEAD, UserRole.PRODUCT_TEAM, UserRole.ADMIN];
export const ALL_ACTION_ROLES = [UserRole.CS_LEAD, UserRole.PRODUCT_LEAD, UserRole.PRODUCT_TEAM, UserRole.ADMIN];

// ===== Ticket Status States =====
export enum TicketStatus {
  NEW_ESCALATION = 'NEW_ESCALATION',
  RESOLVED_BY_CS = 'RESOLVED_BY_CS',
  PENDING_PROD_REVIEW = 'PENDING_PROD_REVIEW',
  IN_PRODUCT_SCOPE = 'IN_PRODUCT_SCOPE',
  IN_PROGRESS = 'IN_PROGRESS',
  ON_HOLD_UNTIL = 'ON_HOLD_UNTIL',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
  RETURNED_TO_CS = 'RETURNED_TO_CS',
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

// ===== Sprint Status (editable from PENDING_PROD_REVIEW onwards) =====
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
  secondary_email: string | null;
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
  freshdesk_id: string | null; // JIRA ticket URL
  hold_until_date: string | null;
  last_product_activity_at: string;
  is_reopened: boolean;
  reopen_count: number;
  sla_breach_count: number;
  reporter_id: string;
  reporter?: AppUser;
  assignee_id: string | null;
  assignee?: AppUser;
  latest_comment: string | null;
  jira_status: string | null;
  last_jira_status_change_at: string | null;
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
  | 'pending_cs'
  | 'pending_product'
  | 'in_scope'
  | 'in_progress'
  | 'on_hold'
  | 'returned_to_cs'
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
  createdBy: string | 'ALL';
  assignee: string | 'ALL';
}

// ===== Display Constants =====
export const STATUS_LABELS: Record<TicketStatus, string> = {
  [TicketStatus.NEW_ESCALATION]: 'New Escalation',
  [TicketStatus.RESOLVED_BY_CS]: 'Resolved by CS Lead',
  [TicketStatus.PENDING_PROD_REVIEW]: 'Pending Product Review',
  [TicketStatus.IN_PRODUCT_SCOPE]: 'In Product Scope',
  [TicketStatus.IN_PROGRESS]: 'In Progress',
  [TicketStatus.ON_HOLD_UNTIL]: 'On Hold',
  [TicketStatus.RESOLVED]: 'Resolved',
  [TicketStatus.CLOSED]: 'Closed',
  [TicketStatus.RETURNED_TO_CS]: 'Returned to CS Lead',
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
  [TicketStatus.IN_PROGRESS]: 'bg-indigo-100 text-indigo-800',
  [TicketStatus.ON_HOLD_UNTIL]: 'bg-orange-100 text-orange-800',
  [TicketStatus.RESOLVED]: 'bg-green-100 text-green-800',
  [TicketStatus.CLOSED]: 'bg-gray-200 text-gray-700',
  [TicketStatus.RETURNED_TO_CS]: 'bg-amber-100 text-amber-800',
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

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'CS Manager',
  [UserRole.CS_LEAD]: 'CS Lead',
  [UserRole.PRODUCT_LEAD]: 'Product Lead',
  [UserRole.PRODUCT_TEAM]: 'Product Team',
  [UserRole.ADMIN]: 'Admin',
};

export const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'bg-teal-100 text-teal-800',
  [UserRole.CS_LEAD]: 'bg-blue-100 text-blue-800',
  [UserRole.PRODUCT_LEAD]: 'bg-purple-100 text-purple-800',
  [UserRole.PRODUCT_TEAM]: 'bg-violet-100 text-violet-800',
  [UserRole.ADMIN]: 'bg-red-100 text-red-800',
};

// ===== Status Display Helpers =====
export const REOPENED_LABEL = 'Reopened';
export const REOPENED_COLOR = 'bg-red-100 text-red-700';

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
