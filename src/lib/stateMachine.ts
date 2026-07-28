import { TicketStatus, UserRole } from '../types';

// Defines which transitions are allowed and by which role
interface Transition {
  from: TicketStatus;
  to: TicketStatus;
  allowedRoles: UserRole[];
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
];

export function canTransition(
  currentStatus: TicketStatus,
  targetStatus: TicketStatus,
  userRole: UserRole
): boolean {
  return ALLOWED_TRANSITIONS.some(
    t => t.from === currentStatus && t.to === targetStatus && t.allowedRoles.includes(userRole)
  );
}

export function getAvailableTransitions(
  currentStatus: TicketStatus,
  userRole: UserRole
): TicketStatus[] {
  return ALLOWED_TRANSITIONS
    .filter(t => t.from === currentStatus && t.allowedRoles.includes(userRole))
    .map(t => t.to);
}

// Progress update is allowed without status change for PRODUCT_LEAD on IN_PRODUCT_SCOPE tickets
export function canPostUpdate(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return userRole === UserRole.PRODUCT_LEAD && currentStatus === TicketStatus.IN_PRODUCT_SCOPE;
}
