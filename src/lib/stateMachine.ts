import { TicketStatus, UserRole } from '../types';

// Defines which transitions are allowed and by which role
interface Transition {
  from: TicketStatus;
  to: TicketStatus;
  allowedRoles: UserRole[];
  creatorOnly?: boolean; // If true, only the ticket creator can perform this
}

const ALLOWED_TRANSITIONS: Transition[] = [
  // CS Lead actions
  { from: TicketStatus.NEW_ESCALATION, to: TicketStatus.RESOLVED_BY_CS, allowedRoles: [UserRole.CS_LEAD] },
  { from: TicketStatus.NEW_ESCALATION, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: [UserRole.CS_LEAD] },

  // Product Lead actions
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.IN_PRODUCT_SCOPE, allowedRoles: [UserRole.PRODUCT_LEAD] },
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: [UserRole.PRODUCT_LEAD] },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: [UserRole.PRODUCT_LEAD] },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.RESOLVED, allowedRoles: [UserRole.PRODUCT_LEAD] },
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.IN_PRODUCT_SCOPE, allowedRoles: [UserRole.PRODUCT_LEAD] },
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: [UserRole.PRODUCT_LEAD] },

  // Creator-only actions (Close and Reopen)
  { from: TicketStatus.RESOLVED, to: TicketStatus.CLOSED, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD], creatorOnly: true },
  { from: TicketStatus.RESOLVED_BY_CS, to: TicketStatus.CLOSED, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD], creatorOnly: true },
  { from: TicketStatus.RESOLVED, to: TicketStatus.NEW_ESCALATION, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD], creatorOnly: true },
  { from: TicketStatus.RESOLVED_BY_CS, to: TicketStatus.NEW_ESCALATION, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD], creatorOnly: true },
];

export function canTransition(
  currentStatus: TicketStatus,
  targetStatus: TicketStatus,
  userRole: UserRole,
  userId: string,
  reporterId: string
): boolean {
  return ALLOWED_TRANSITIONS.some(t => {
    if (t.from !== currentStatus || t.to !== targetStatus) return false;
    if (!t.allowedRoles.includes(userRole)) return false;
    if (t.creatorOnly && userId !== reporterId) return false;
    return true;
  });
}

export function getAvailableTransitions(
  currentStatus: TicketStatus,
  userRole: UserRole,
  userId: string,
  reporterId: string
): TicketStatus[] {
  return ALLOWED_TRANSITIONS
    .filter(t => {
      if (t.from !== currentStatus) return false;
      if (!t.allowedRoles.includes(userRole)) return false;
      if (t.creatorOnly && userId !== reporterId) return false;
      return true;
    })
    .map(t => t.to);
}

// Progress update is allowed without status change for PRODUCT_LEAD on IN_PRODUCT_SCOPE tickets
export function canPostUpdate(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return userRole === UserRole.PRODUCT_LEAD && currentStatus === TicketStatus.IN_PRODUCT_SCOPE;
}

// Priority can be changed by CS_LEAD and PRODUCT_LEAD at any stage
export function canChangePriority(userRole: UserRole): boolean {
  return userRole === UserRole.CS_LEAD || userRole === UserRole.PRODUCT_LEAD;
}

// Sprint status can be changed by PRODUCT_LEAD on IN_PRODUCT_SCOPE tickets
export function canChangeSprintStatus(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return userRole === UserRole.PRODUCT_LEAD && currentStatus === TicketStatus.IN_PRODUCT_SCOPE;
}

// Revert is allowed for CS_LEAD and PRODUCT_LEAD
export function canRevertLastAction(userRole: UserRole): boolean {
  return userRole === UserRole.CS_LEAD || userRole === UserRole.PRODUCT_LEAD;
}

// Check if a transition is a "reopen" (sets ticket back to NEW_ESCALATION from resolved states)
export function isReopenTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (
    (from === TicketStatus.RESOLVED || from === TicketStatus.RESOLVED_BY_CS) &&
    to === TicketStatus.NEW_ESCALATION
  );
}
