import { TicketStatus, UserRole, SprintStatus, LEAD_ROLES, PRODUCT_ROLES, ALL_ACTION_ROLES } from '../types';

// ===== STATUS CHANGES =====
// CS_LEAD, PRODUCT_LEAD, PRODUCT_TEAM, and ADMIN can move a ticket to any
// stage directly — a single stage picker, not a fixed per-pair map — with
// two exceptions that apply to everyone, admin included, because they're
// workflow-logic rules rather than access-control ones:
//   - "Resolved by CS Lead" only makes sense as a CS-triage outcome, so it's
//     only offered while the ticket is still at New Escalation — once it's
//     moved on (e.g. into Product's hands), that option disappears.
//   - New Escalation ("Pending CS Triage") itself is never a selectable
//     target: it's the state a ticket is created in, not something to move
//     back to.
// Closing IS an access-control exception: it's the ticket creator's right
// alone (since v1), regardless of role, and only once actually resolved —
// except ADMIN, which can close any ticket, per explicit request for a
// testing/unblocking override.
// CS_MANAGER gets no free-form access — their only status-change ability is
// closing a resolved ticket they personally reported (the same rule above,
// just without a role that could otherwise bypass it).
const ALL_OTHER_STATUSES = Object.values(TicketStatus).filter(
  status => status !== TicketStatus.NEW_ESCALATION
);

const CLOSABLE_FROM = [TicketStatus.RESOLVED, TicketStatus.RESOLVED_BY_CS];

export function getAvailableTransitions(
  currentStatus: TicketStatus,
  userRole: UserRole,
  userId: string,
  reporterId: string
): TicketStatus[] {
  if (ALL_ACTION_ROLES.includes(userRole)) {
    return ALL_OTHER_STATUSES.filter(status => {
      if (status === currentStatus) return false;
      if (status === TicketStatus.RESOLVED_BY_CS) return currentStatus === TicketStatus.NEW_ESCALATION;
      if (status === TicketStatus.CLOSED) {
        if (userRole === UserRole.ADMIN) return true;
        return CLOSABLE_FROM.includes(currentStatus) && userId === reporterId;
      }
      return true;
    });
  }

  if (userRole === UserRole.CS_MANAGER && userId === reporterId && CLOSABLE_FROM.includes(currentStatus)) {
    return [TicketStatus.CLOSED];
  }

  return [];
}

export function canTransition(
  currentStatus: TicketStatus,
  targetStatus: TicketStatus,
  userRole: UserRole,
  userId: string,
  reporterId: string
): boolean {
  return getAvailableTransitions(currentStatus, userRole, userId, reporterId).includes(targetStatus);
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
