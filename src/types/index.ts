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
  subject: string;
  description: string;
  sub_type: TicketSubType;
  priority: Priority;
  status: TicketStatus;
  freshdesk_id: string | null;
  hold_until_date: string | null;
  last_product_activity_at: string;
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
  | 'pending_cs'
  | 'pending_product'
  | 'in_scope'
  | 'on_hold'
  | 'closed';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  [TicketStatus.NEW_ESCALATION]: 'New Escalation',
  [TicketStatus.RESOLVED_BY_CS]: 'Resolved by CS',
  [TicketStatus.PENDING_PROD_REVIEW]: 'Pending Product Review',
  [TicketStatus.IN_PRODUCT_SCOPE]: 'In Product Scope',
  [TicketStatus.ON_HOLD_UNTIL]: 'On Hold',
  [TicketStatus.RESOLVED]: 'Resolved',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  [Priority.LOW]: 'bg-gray-100 text-gray-700',
  [Priority.MEDIUM]: 'bg-blue-100 text-blue-700',
  [Priority.HIGH]: 'bg-orange-100 text-orange-700',
  [Priority.CRITICAL]: 'bg-red-100 text-red-700',
};

export const STATUS_COLORS: Record<TicketStatus, string> = {
  [TicketStatus.NEW_ESCALATION]: 'bg-yellow-100 text-yellow-800',
  [TicketStatus.RESOLVED_BY_CS]: 'bg-green-100 text-green-800',
  [TicketStatus.PENDING_PROD_REVIEW]: 'bg-purple-100 text-purple-800',
  [TicketStatus.IN_PRODUCT_SCOPE]: 'bg-blue-100 text-blue-800',
  [TicketStatus.ON_HOLD_UNTIL]: 'bg-orange-100 text-orange-800',
  [TicketStatus.RESOLVED]: 'bg-green-100 text-green-800',
};
