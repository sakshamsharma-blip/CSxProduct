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
  { from: TicketStatus.NEW_ESCALATION, to: TicketStatus.RESOLVED_BY_CS, allowedRoles: [UserRole.CS_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.NEW_ESCALATION, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: [UserRole.CS_LEAD, UserRole.ADMIN] },

  // Product Lead actions
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.IN_PRODUCT_SCOPE, allowedRoles: [UserRole.PRODUCT_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: [UserRole.PRODUCT_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: [UserRole.PRODUCT_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.RESOLVED, allowedRoles: [UserRole.PRODUCT_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.IN_PRODUCT_SCOPE, allowedRoles: [UserRole.PRODUCT_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: [UserRole.PRODUCT_LEAD, UserRole.ADMIN] },

  // Creator-only actions (Close and Reopen) — ADMIN can always do these
  { from: TicketStatus.RESOLVED, to: TicketStatus.CLOSED, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN], creatorOnly: true },
  { from: TicketStatus.RESOLVED_BY_CS, to: TicketStatus.CLOSED, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN], creatorOnly: true },
  { from: TicketStatus.RESOLVED, to: TicketStatus.NEW_ESCALATION, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN], creatorOnly: true },
  { from: TicketStatus.RESOLVED_BY_CS, to: TicketStatus.NEW_ESCALATION, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN], creatorOnly: true },
];

export function canTransition(
  currentStatus: TicketStatus,
  targetStatus: TicketStatus,
  userRole: UserRole,
  userId: string,
  reporterId: string
): boolean {
  // ADMIN bypasses creator-only restriction
  if (userRole === UserRole.ADMIN) {
    return ALLOWED_TRANSITIONS.some(t => t.from === currentStatus && t.to === targetStatus);
  }

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
  // ADMIN sees all possible transitions from current status
  if (userRole === UserRole.ADMIN) {
    return ALLOWED_TRANSITIONS
      .filter(t => t.from === currentStatus)
      .map(t => t.to);
  }

  return ALLOWED_TRANSITIONS
    .filter(t => {
      if (t.from !== currentStatus) return false;
      if (!t.allowedRoles.includes(userRole)) return false;
      if (t.creatorOnly && userId !== reporterId) return false;
      return true;
    })
    .map(t => t.to);
}

// Progress update — ADMIN or PRODUCT_LEAD on IN_PRODUCT_SCOPE
export function canPostUpdate(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return (userRole === UserRole.PRODUCT_LEAD || userRole === UserRole.ADMIN) && currentStatus === TicketStatus.IN_PRODUCT_SCOPE;
}

// Priority change — everyone can change priority EXCEPT when sprint_status is IN_SPRINT
// (only CS_LEAD, PRODUCT_LEAD, ADMIN can override even in sprint)
export function canChangePriority(userRole: UserRole, sprintStatus?: string | null): boolean {
  if (sprintStatus === 'IN_SPRINT') {
    // Only leads and admin can change priority on in-sprint tickets
    return userRole === UserRole.CS_LEAD || userRole === UserRole.PRODUCT_LEAD || userRole === UserRole.ADMIN;
  }
  // Everyone (including CSM) can change priority otherwise
  return true;
}

// Sprint status — PRODUCT_LEAD or ADMIN on IN_PRODUCT_SCOPE
export function canChangeSprintStatus(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return (userRole === UserRole.PRODUCT_LEAD || userRole === UserRole.ADMIN) && currentStatus === TicketStatus.IN_PRODUCT_SCOPE;
}

// Revert — CS_LEAD, PRODUCT_LEAD, or ADMIN
export function canRevertLastAction(userRole: UserRole): boolean {
  return userRole === UserRole.CS_LEAD || userRole === UserRole.PRODUCT_LEAD || userRole === UserRole.ADMIN;
}

// Check if a transition is a "reopen"
export function isReopenTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (
    (from === TicketStatus.RESOLVED || from === TicketStatus.RESOLVED_BY_CS) &&
    to === TicketStatus.NEW_ESCALATION
  );
}
