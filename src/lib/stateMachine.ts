import { TicketStatus, UserRole, SprintStatus, LEAD_ROLES, PRODUCT_ROLES, ALL_ACTION_ROLES } from '../types';

// ===== TRANSITION RULES =====
// CS_LEAD and PRODUCT_LEAD/PRODUCT_TEAM now share most actions (merged per pilot feedback).

interface Transition {
  from: TicketStatus;
  to: TicketStatus;
  allowedRoles: UserRole[];
  creatorOnly?: boolean; // Only ticket creator can perform this
}

const ALLOWED_TRANSITIONS: Transition[] = [
  // CS Lead actions on new tickets
  { from: TicketStatus.NEW_ESCALATION, to: TicketStatus.RESOLVED_BY_CS, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.NEW_ESCALATION, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: ALL_ACTION_ROLES },

  // Pending Product Review → next stages
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.IN_PRODUCT_SCOPE, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.IN_PROGRESS, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.RESOLVED, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.PENDING_PROD_REVIEW, to: TicketStatus.RETURNED_TO_CS, allowedRoles: PRODUCT_ROLES },

  // In Product Scope → next stages
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.IN_PROGRESS, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.RESOLVED, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.IN_PRODUCT_SCOPE, to: TicketStatus.RETURNED_TO_CS, allowedRoles: PRODUCT_ROLES },

  // In Progress → next stages
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RESOLVED, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.ON_HOLD_UNTIL, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.IN_PROGRESS, to: TicketStatus.RETURNED_TO_CS, allowedRoles: PRODUCT_ROLES },

  // On Hold → back to pipeline
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.IN_PRODUCT_SCOPE, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.IN_PROGRESS, allowedRoles: ALL_ACTION_ROLES },
  { from: TicketStatus.ON_HOLD_UNTIL, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: ALL_ACTION_ROLES },

  // Returned to CS → CS Lead handles
  { from: TicketStatus.RETURNED_TO_CS, to: TicketStatus.PENDING_PROD_REVIEW, allowedRoles: [UserRole.CS_LEAD, UserRole.ADMIN] },
  { from: TicketStatus.RETURNED_TO_CS, to: TicketStatus.RESOLVED_BY_CS, allowedRoles: [UserRole.CS_LEAD, UserRole.ADMIN] },

  // Close — only the creator can close a resolved ticket
  { from: TicketStatus.RESOLVED, to: TicketStatus.CLOSED, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN], creatorOnly: true },
  { from: TicketStatus.RESOLVED_BY_CS, to: TicketStatus.CLOSED, allowedRoles: [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN], creatorOnly: true },

  // Reopen — only the creator can reopen
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
  if (userRole === UserRole.ADMIN) {
    return [...new Set(ALLOWED_TRANSITIONS.filter(t => t.from === currentStatus).map(t => t.to))];
  }

  return [...new Set(
    ALLOWED_TRANSITIONS
      .filter(t => {
        if (t.from !== currentStatus) return false;
        if (!t.allowedRoles.includes(userRole)) return false;
        if (t.creatorOnly && userId !== reporterId) return false;
        return true;
      })
      .map(t => t.to)
  )];
}

// Progress update (resets SLA timer without status change)
// Available on PENDING_PROD_REVIEW, IN_PRODUCT_SCOPE, and IN_PROGRESS for all action roles
export function canPostUpdate(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return ALL_ACTION_ROLES.includes(userRole) &&
    (currentStatus === TicketStatus.PENDING_PROD_REVIEW || currentStatus === TicketStatus.IN_PRODUCT_SCOPE || currentStatus === TicketStatus.IN_PROGRESS);
}

// Priority change — everyone can change EXCEPT when sprint_status is IN_SPRINT
// (only leads/product/admin can override in-sprint)
export function canChangePriority(userRole: UserRole, sprintStatus?: string | null): boolean {
  if (sprintStatus === SprintStatus.IN_SPRINT) {
    return ALL_ACTION_ROLES.includes(userRole);
  }
  return true; // Everyone including CSM
}

// Sprint status — editable from PENDING_PROD_REVIEW onwards by leads/product/admin
export function canChangeSprintStatus(currentStatus: TicketStatus, userRole: UserRole): boolean {
  const editableStatuses = [
    TicketStatus.PENDING_PROD_REVIEW,
    TicketStatus.IN_PRODUCT_SCOPE,
    TicketStatus.IN_PROGRESS,
  ];
  return ALL_ACTION_ROLES.includes(userRole) && editableStatuses.includes(currentStatus);
}

// Revert — leads and product roles
export function canRevertLastAction(userRole: UserRole): boolean {
  return ALL_ACTION_ROLES.includes(userRole);
}

// Assignee — only Product Lead, Product Team, Admin
export function canChangeAssignee(userRole: UserRole): boolean {
  return PRODUCT_ROLES.includes(userRole);
}

// Check if a transition is a "reopen"
export function isReopenTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (
    (from === TicketStatus.RESOLVED || from === TicketStatus.RESOLVED_BY_CS) &&
    to === TicketStatus.NEW_ESCALATION
  );
}
