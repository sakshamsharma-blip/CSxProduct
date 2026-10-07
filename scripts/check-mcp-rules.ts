// Drift check: makes sure the MCP server's copy of the business rules
// (supabase/functions/_shared/flowRules.ts) still agrees with the web app's
// (src/lib/stateMachine.ts, src/types, src/lib/jiraUtils.ts).
//
// Run:  deno run --unstable-sloppy-imports scripts/check-mcp-rules.ts
// Exit code 1 = the two copies disagree somewhere.

import * as app from '../src/lib/stateMachine.ts';
import * as appTypes from '../src/types/index.ts';
import * as appJira from '../src/lib/jiraUtils.ts';
import * as mcp from '../supabase/functions/_shared/flowRules.ts';

let failures = 0;
function same(label: string, a: unknown, b: unknown) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    failures++;
    console.error(`✗ ${label}\n    app: ${ja}\n    mcp: ${jb}`);
  }
}

// Enums and labels
same('UserRole values', Object.values(appTypes.UserRole), Object.values(mcp.UserRole));
same('TicketStatus values', Object.values(appTypes.TicketStatus), Object.values(mcp.TicketStatus));
same('TicketSubType values', Object.values(appTypes.TicketSubType), Object.values(mcp.TicketSubType));
same('Priority values', Object.values(appTypes.Priority), Object.values(mcp.Priority));
same('SprintStatus values', Object.values(appTypes.SprintStatus), Object.values(mcp.SprintStatus));
same('STATUS_LABELS', appTypes.STATUS_LABELS, mcp.STATUS_LABELS);
same('ROLE_LABELS', appTypes.ROLE_LABELS, mcp.ROLE_LABELS);
same('ALL_ACTION_ROLES', appTypes.ALL_ACTION_ROLES, mcp.ALL_ACTION_ROLES);
same('PRODUCT_ROLES', appTypes.PRODUCT_ROLES, mcp.PRODUCT_ROLES);

// State machine across every role × status × (reporter or not) × sprint value
const ME = 'me';
const statuses = Object.values(mcp.TicketStatus);
const sprints = [null, ...Object.values(mcp.SprintStatus)];
for (const role of Object.values(mcp.UserRole)) {
  for (const status of statuses) {
    for (const reporter of [ME, 'someone-else']) {
      const appRole = role as unknown as appTypes.UserRole;
      const appStatus = status as unknown as appTypes.TicketStatus;
      same(`transitions ${role} @ ${status} reporter=${reporter === ME}`,
        app.getAvailableTransitions(appStatus, appRole, ME, reporter),
        mcp.getAvailableTransitions(status, role, ME, reporter));
      for (const target of statuses) {
        same(`isReopen ${status}→${target}`,
          app.isReopenTransition(appStatus, target as unknown as appTypes.TicketStatus),
          mcp.isReopenTransition(status, target));
      }
    }
    same(`canPostUpdate ${role} @ ${status}`, app.canPostUpdate(status as never, role as never), mcp.canPostUpdate(status, role));
    same(`canChangeSprintStatus ${role} @ ${status}`, app.canChangeSprintStatus(status as never, role as never), mcp.canChangeSprintStatus(status, role));
  }
  for (const sprint of sprints) {
    same(`canChangePriority ${role} sprint=${sprint}`, app.canChangePriority(role as never, sprint), mcp.canChangePriority(role, sprint));
  }
  same(`canChangeAssignee ${role}`, app.canChangeAssignee(role as never), mcp.canChangeAssignee(role));
  same(`canRevert ${role} (mcp has no revert; app should match ALL_ACTION_ROLES)`,
    app.canRevertLastAction(role as never), mcp.ALL_ACTION_ROLES.includes(role));
}

// Jira helpers
for (const input of ['', '  ', 'EA-123', 'ea-9', 'https://crelio.atlassian.net/browse/EN-4', 'random text', null]) {
  same(`normalizeJiraInput(${JSON.stringify(input)})`, appJira.normalizeJiraInput(input), mcp.normalizeJiraInput(input));
  same(`extractJiraKey(${JSON.stringify(input)})`, appJira.extractJiraKey(input), mcp.extractJiraKey(input));
}

if (failures > 0) {
  console.error(`\n${failures} difference(s) between the web app rules and the MCP rules.`);
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.exit(1);
} else {
  console.log('✓ MCP rules match the web app rules.');
}
