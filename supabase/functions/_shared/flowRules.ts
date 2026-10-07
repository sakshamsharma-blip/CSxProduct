// =============================================================
// Flow business rules — server-side (Deno) mirror for the MCP server
// =============================================================
// The web app's source of truth lives in:
//   src/types/index.ts        (statuses, roles, labels)
//   src/lib/stateMachine.ts   (who can move a ticket where)
//   src/hooks/useTickets.tsx  (role visibility, weekly-update SLA)
//   src/lib/analytics.ts      (analytics numbers)
//   src/lib/jiraUtils.ts      (Jira link handling)
//
// Edge Functions can't import those files directly (Deno needs explicit
// file extensions and the functions bundle can't reach src/), so the rules
// are mirrored here with NO imports at all. If you change a rule in src/,
// change it here too — then run:
//
//   deno run --unstable-sloppy-imports scripts/check-mcp-rules.ts
//
// which compares both copies across every role × status combination and
// fails if they disagree. The database (RLS, migration 006) is the final
// guard either way: if this file ever drifts, a forbidden change is still
// rejected by Postgres.
// =============================================================

// ===== Enums (string values match the Postgres enums) =====
export enum UserRole {
  CS_MANAGER = 'CS_MANAGER',
  CS_LEAD = 'CS_LEAD',
  PRODUCT_LEAD = 'PRODUCT_LEAD',
  PRODUCT_TEAM = 'PRODUCT_TEAM',
  ADMIN = 'ADMIN',
}

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

export enum TicketSubType {
  BUG = 'BUG',
  ENHANCEMENT = 'ENHANCEMENT',
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  BACKEND_CONFIG = 'BACKEND_CONFIG',
}

export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum SprintStatus {
  IN_SPRINT = 'IN_SPRINT',
  NEXT_SPRINT = 'NEXT_SPRINT',
  AWAITED = 'AWAITED',
}

export const ALL_ACTION_ROLES = [UserRole.CS_LEAD, UserRole.PRODUCT_LEAD, UserRole.PRODUCT_TEAM, UserRole.ADMIN];
export const PRODUCT_ROLES = [UserRole.PRODUCT_LEAD, UserRole.PRODUCT_TEAM, UserRole.ADMIN];
export const CREATE_ROLES = [UserRole.CS_MANAGER, UserRole.CS_LEAD, UserRole.ADMIN];
export const ANALYTICS_ROLES = [UserRole.CS_LEAD, UserRole.PRODUCT_LEAD, UserRole.PRODUCT_TEAM, UserRole.ADMIN];

// ===== Labels (what people see in the web app) =====
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

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.CS_MANAGER]: 'CS Manager',
  [UserRole.CS_LEAD]: 'CS Lead',
  [UserRole.PRODUCT_LEAD]: 'Product Lead',
  [UserRole.PRODUCT_TEAM]: 'Product Team',
  [UserRole.ADMIN]: 'Admin',
};

export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  [SprintStatus.IN_SPRINT]: 'In Sprint',
  [SprintStatus.NEXT_SPRINT]: 'Next Sprint',
  [SprintStatus.AWAITED]: 'Awaited',
};

export const SUB_TYPE_LABELS: Record<TicketSubType, string> = {
  [TicketSubType.BUG]: 'Bug',
  [TicketSubType.ENHANCEMENT]: 'Enhancement',
  [TicketSubType.FEATURE_REQUEST]: 'Feature Request',
  [TicketSubType.BACKEND_CONFIG]: 'Backend Config',
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  [Priority.CRITICAL]: 0,
  [Priority.HIGH]: 1,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 3,
};

// ===== Minimal ticket shape the rules need =====
export interface RuleTicket {
  id: string;
  status: TicketStatus | string;
  reporter_id: string;
  last_product_activity_at: string;
  last_jira_status_change_at: string | null;
  hold_until_date: string | null;
  is_reopened?: boolean;
}

// ===== State machine (mirror of src/lib/stateMachine.ts) =====
const ALL_OTHER_STATUSES = Object.values(TicketStatus).filter(s => s !== TicketStatus.NEW_ESCALATION);
const CLOSABLE_FROM: string[] = [TicketStatus.RESOLVED, TicketStatus.RESOLVED_BY_CS];

export function getAvailableTransitions(
  currentStatus: TicketStatus,
  userRole: UserRole,
  userId: string,
  reporterId: string,
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
  reporterId: string,
): boolean {
  return getAvailableTransitions(currentStatus, userRole, userId, reporterId).includes(targetStatus);
}

export function canPostUpdate(currentStatus: TicketStatus, userRole: UserRole): boolean {
  return ALL_ACTION_ROLES.includes(userRole) &&
    (currentStatus === TicketStatus.PENDING_PROD_REVIEW ||
      currentStatus === TicketStatus.IN_PRODUCT_SCOPE ||
      currentStatus === TicketStatus.IN_PROGRESS);
}

export function canChangePriority(userRole: UserRole, sprintStatus?: string | null): boolean {
  if (sprintStatus === SprintStatus.IN_SPRINT) return ALL_ACTION_ROLES.includes(userRole);
  return true;
}

export function canChangeSprintStatus(currentStatus: TicketStatus, userRole: UserRole): boolean {
  const editable = [TicketStatus.PENDING_PROD_REVIEW, TicketStatus.IN_PRODUCT_SCOPE, TicketStatus.IN_PROGRESS];
  return ALL_ACTION_ROLES.includes(userRole) && editable.includes(currentStatus);
}

export function canChangeAssignee(userRole: UserRole): boolean {
  return PRODUCT_ROLES.includes(userRole);
}

export function isReopenTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (from === TicketStatus.RESOLVED || from === TicketStatus.RESOLVED_BY_CS) &&
    to === TicketStatus.NEW_ESCALATION;
}

// Side effects of a stage change (mirror of batchSave in src/lib/actions.ts)
export const PRODUCT_ACTIVITY_STATUSES = [
  TicketStatus.IN_PRODUCT_SCOPE, TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED, TicketStatus.ON_HOLD_UNTIL,
];
export const SPRINT_CLEARING_STATUSES = [
  TicketStatus.RETURNED_TO_CS, TicketStatus.CLOSED, TicketStatus.NEW_ESCALATION,
];

// ===== Visibility (mirror of getVisibleTickets in src/hooks/useTickets.tsx) =====
const PRODUCT_VISIBLE_STATUSES: string[] = [
  TicketStatus.PENDING_PROD_REVIEW, TicketStatus.IN_PRODUCT_SCOPE, TicketStatus.IN_PROGRESS,
  TicketStatus.ON_HOLD_UNTIL, TicketStatus.RESOLVED, TicketStatus.RETURNED_TO_CS, TicketStatus.CLOSED,
];

export function isTicketVisible(ticket: Pick<RuleTicket, 'status' | 'reporter_id'>, role: UserRole, userId: string): boolean {
  if (role === UserRole.ADMIN) return true;
  if (role === UserRole.CS_MANAGER) return ticket.reporter_id === userId;
  if (role === UserRole.PRODUCT_LEAD || role === UserRole.PRODUCT_TEAM) {
    return PRODUCT_VISIBLE_STATUSES.includes(ticket.status);
  }
  return true; // CS_LEAD
}

// ===== Queues (mirror of filterTicketsByTab) =====
export const QUEUES = {
  all: null,
  pending_cs: [TicketStatus.NEW_ESCALATION],
  returned_to_cs: [TicketStatus.RETURNED_TO_CS],
  pending_product: [TicketStatus.PENDING_PROD_REVIEW],
  in_scope: [TicketStatus.IN_PRODUCT_SCOPE],
  in_progress: [TicketStatus.IN_PROGRESS],
  on_hold: [TicketStatus.ON_HOLD_UNTIL],
  resolved: [TicketStatus.RESOLVED, TicketStatus.RESOLVED_BY_CS],
  closed: [TicketStatus.CLOSED],
} as const;
export type QueueKey = keyof typeof QUEUES;

// ===== Weekly-update SLA (mirror of needsWeeklyUpdate / isHoldExpired) =====
export function lastActivityAt(ticket: Pick<RuleTicket, 'last_product_activity_at' | 'last_jira_status_change_at'>): Date {
  const manual = new Date(ticket.last_product_activity_at).getTime();
  const jira = ticket.last_jira_status_change_at ? new Date(ticket.last_jira_status_change_at).getTime() : 0;
  return new Date(Math.max(manual, jira));
}

export function needsWeeklyUpdate(ticket: RuleTicket, now: Date = new Date()): boolean {
  if (ticket.status !== TicketStatus.IN_PRODUCT_SCOPE && ticket.status !== TicketStatus.IN_PROGRESS) return false;
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return lastActivityAt(ticket) < sevenDaysAgo;
}

export function isHoldExpired(ticket: RuleTicket, now: Date = new Date()): boolean {
  if (ticket.status !== TicketStatus.ON_HOLD_UNTIL || !ticket.hold_until_date) return false;
  return new Date(ticket.hold_until_date) <= now;
}

export function daysBetween(from: Date | string, to: Date = new Date()): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000);
}

// ===== Jira (mirror of src/lib/jiraUtils.ts) =====
const JIRA_DOMAIN = 'crelio.atlassian.net';

export function normalizeJiraInput(input: string | null | undefined): string | null {
  if (!input || !input.trim()) return null;
  const trimmed = input.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  const keyMatch = trimmed.match(/^([A-Z][A-Z0-9]+-\d+)$/i);
  if (keyMatch) return `https://${JIRA_DOMAIN}/browse/${keyMatch[1].toUpperCase()}`;
  return trimmed;
}

export function extractJiraKey(input: string | null): string | null {
  if (!input) return null;
  const match = input.match(/([A-Z][A-Z0-9]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

// ===== Analytics (mirror of src/lib/analytics.ts, without date-fns) =====
export type TimePeriod = 'this_week' | 'mtd' | 'ytd' | 'all_time' | 'custom';

// The web app computes week/month/year starts in the viewer's browser
// (India). Edge Functions run in UTC, so day boundaries are shifted to IST
// (UTC+05:30, no daylight saving) to give the same numbers as the app.
export const IST_OFFSET_MINUTES = 330;

export function getDateRange(
  period: TimePeriod,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
  tzOffsetMinutes: number = IST_OFFSET_MINUTES,
) {
  const offsetMs = tzOffsetMinutes * 60_000;
  const local = new Date(now.getTime() + offsetMs); // wall-clock time, read with UTC getters
  local.setUTCHours(0, 0, 0, 0);
  const toInstant = (d: Date) => new Date(d.getTime() - offsetMs);
  // "YYYY-MM-DD" → local midnight of that day (end date is inclusive of the whole day)
  const parseDay = (s: string, endOfDay: boolean) => {
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
    return new Date(toInstant(d).getTime() - (endOfDay ? 1 : 0));
  };
  switch (period) {
    case 'this_week': {
      const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
      local.setUTCDate(local.getUTCDate() - dow);
      return { start: toInstant(local), end: now };
    }
    case 'mtd':
      local.setUTCDate(1);
      return { start: toInstant(local), end: now };
    case 'ytd':
      local.setUTCMonth(0, 1);
      return { start: toInstant(local), end: now };
    case 'custom':
      return {
        start: customStart ? parseDay(customStart, false) : new Date(Date.UTC(2020, 0, 1)),
        end: customEnd ? parseDay(customEnd, true) : now,
      };
    default:
      return { start: new Date(Date.UTC(2020, 0, 1)), end: now };
  }
}

export function hoursBetween(from: string, to: string): number {
  return Math.trunc((new Date(to).getTime() - new Date(from).getTime()) / 3_600_000);
}

export function formatTAT(hours: number): string {
  if (hours === 0) return '—';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}
