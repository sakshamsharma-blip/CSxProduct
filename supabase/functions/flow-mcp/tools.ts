// Flow MCP tools. Each tool:
//   1. applies the same role rules as the web app (flowRules.ts), so the
//      user gets a clear "you can't do that" instead of a database error, and
//   2. writes with the caller's own token, so Postgres RLS is the final guard.

import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.32.1/server/mcp.js';
import type { ToolAnnotations } from 'npm:@modelcontextprotocol/sdk@1.32.1/types.js';
import { z } from 'npm:zod@4.6.5';
import {
  UserRole, TicketStatus, TicketSubType, Priority, SprintStatus,
  STATUS_LABELS, ROLE_LABELS, SUB_TYPE_LABELS, SPRINT_STATUS_LABELS, PRIORITY_ORDER,
  ALL_ACTION_ROLES, CREATE_ROLES, ANALYTICS_ROLES, QUEUES, type QueueKey,
  getAvailableTransitions, canTransition, canPostUpdate, canChangePriority, canChangeSprintStatus,
  canChangeAssignee, isReopenTransition, PRODUCT_ACTIVITY_STATUSES, SPRINT_CLEARING_STATUSES,
  needsWeeklyUpdate, isHoldExpired, lastActivityAt, daysBetween, normalizeJiraInput,
  getDateRange, hoursBetween, formatTAT, isTicketVisible, canEditDetails, canLinkJira, extractJiraKey, type TimePeriod,
} from '../_shared/flowRules.ts';
import {
  type Ctx, type TicketRow, type LogRow, UserFacingError, dbError, fetchAll,
  loadAllTickets, loadVisibleTickets, findTicket, loadTimeline, loadProductUsers, loadActivity,
  ticketSummary, ticketDetail, timelineEntry, stageLabel,
} from './data.ts';

// Appended to audit-log comments written through the MCP so the timeline
// shows the action came via Claude. Set FLOW_MCP_AUDIT_TAG="" to turn off.
const AUDIT_TAG = Deno.env.get('FLOW_MCP_AUDIT_TAG') ?? '(via Claude)';
function tagged(comment: string): string {
  return AUDIT_TAG ? `${comment} ${AUDIT_TAG}` : comment;
}

// ===== Result helpers =====
function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
// Registers a tool whose handler gets fully-typed arguments (inferred from
// the zod shape) and whose expected failures come back as a readable error.
interface ToolConfig<S extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
}
function addTool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<S>,
  // deno-lint-ignore no-explicit-any
  fn: (args: z.infer<z.ZodObject<S>>) => Promise<any>,
) {
  // deno-lint-ignore no-explicit-any
  server.registerTool(name, config as any, (async (args: any) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof UserFacingError) return fail(err.message);
      console.error(`[flow-mcp] ${name} failed`, err);
      return fail('Something went wrong on the Flow server. Please try again.');
    }
  // deno-lint-ignore no-explicit-any
  }) as any);
}

// ===== Shared input schemas =====
const stageEnum = z.enum(Object.values(TicketStatus) as [TicketStatus, ...TicketStatus[]]);
const priorityEnum = z.enum(Object.values(Priority) as [Priority, ...Priority[]]);
const subTypeEnum = z.enum(Object.values(TicketSubType) as [TicketSubType, ...TicketSubType[]]);
const sprintEnum = z.enum(Object.values(SprintStatus) as [SprintStatus, ...SprintStatus[]]);
const queueEnum = z.enum(Object.keys(QUEUES) as [QueueKey, ...QueueKey[]]);
const ticketIdField = z.string().min(1).describe('Flow ticket ID, e.g. "REQ-1042" (or just 1042)');
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const STAGE_GUIDE = Object.entries(STATUS_LABELS).map(([code, label]) => `${code} = "${label}"`).join('; ');

function todayIST(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

// ===== What can this user do on this ticket? =====
function allowedActions(ctx: Ctx, t: TicketRow) {
  const { role, id } = ctx.me;
  return {
    move_to_stages: getAvailableTransitions(t.status, role, id, t.reporter_id)
      .map(s => ({ code: s, label: STATUS_LABELS[s] })),
    can_change_priority: canChangePriority(role, t.sprint_status),
    can_change_sprint_status: canChangeSprintStatus(t.status, role),
    can_change_assignee: canChangeAssignee(role),
    can_post_weekly_update: canPostUpdate(t.status, role),
    can_edit_details: canEditDetails(role, id, t.reporter_id),
    can_link_jira: canLinkJira(role, id, t.reporter_id),
    can_comment: true,
  };
}

export function registerTools(server: McpServer, ctx: Ctx) {
  const { me } = ctx;

  // ---------------------------------------------------------------- whoami
  addTool(server, 'whoami', {
    title: 'Who am I in Flow',
    description: 'Shows which Flow (CrelioHealth escalation tracker) account Claude is signed in as, the role, and what that role can do. Call this first if unsure what the user is allowed to do.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => ok({
    name: me.full_name,
    email: me.email,
    role: ROLE_LABELS[me.role],
    role_code: me.role,
    sees: me.role === UserRole.CS_MANAGER ? 'Only tickets you created'
      : (me.role === UserRole.PRODUCT_LEAD || me.role === UserRole.PRODUCT_TEAM) ? 'Tickets from Pending Product Review onwards'
      : 'All tickets',
    can_create_tickets: CREATE_ROLES.includes(me.role),
    can_move_tickets_between_stages: ALL_ACTION_ROLES.includes(me.role)
      ? 'Yes (any stage, except: never back to New Escalation; "Resolved by CS Lead" only from New Escalation; Closed only by the ticket creator once resolved' + (me.role === UserRole.ADMIN ? ' — Admin can always close' : '') + ')'
      : 'Only closing a resolved ticket you created',
    can_assign: canChangeAssignee(me.role),
    can_view_analytics: ANALYTICS_ROLES.includes(me.role),
  }));

  // ---------------------------------------------------------- list_tickets
  addTool(server, 'list_tickets', {
    title: 'List / search Flow tickets',
    description:
      'Lists escalation tickets the user is allowed to see (same visibility as the Flow web app), with optional filters. ' +
      'Queues match the web app tabs: all, pending_cs (New Escalation), returned_to_cs, pending_product (Pending Product Review), ' +
      'in_scope, in_progress, on_hold, resolved (incl. Resolved by CS Lead), closed. Results are newest-updated first unless sort is set.',
    inputSchema: {
      queue: queueEnum.optional().describe('Web-app tab to filter by. Default: all'),
      search: z.string().optional().describe('Free text matched against ticket ID, lab name, client ID, subject, description, latest comment and Jira key'),
      priority: priorityEnum.optional(),
      type: subTypeEnum.optional(),
      client_id: z.string().optional().describe('Exact client ID'),
      created_by: z.string().optional().describe('"me", or part of the creator\'s name/email'),
      assignee: z.string().optional().describe('"me", "unassigned", or part of the assignee\'s name/email'),
      sprint_status: sprintEnum.optional(),
      reopened_only: z.boolean().optional(),
      weekly_update_overdue_only: z.boolean().optional().describe('Only In Scope / In Progress tickets with 7+ days without a product update or Jira change'),
      sort: z.enum(['updated_desc', 'created_desc', 'created_asc', 'priority']).optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Default 25'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (a) => {
    const now = new Date();
    let rows = await loadVisibleTickets(ctx);
    const visibleTotal = rows.length;

    const statuses = a.queue ? QUEUES[a.queue] : null;
    if (statuses) rows = rows.filter(t => (statuses as readonly string[]).includes(t.status));
    if (a.priority) rows = rows.filter(t => t.priority === a.priority);
    if (a.type) rows = rows.filter(t => t.sub_type === a.type);
    if (a.client_id) rows = rows.filter(t => t.client_id.trim().toLowerCase() === a.client_id!.trim().toLowerCase());
    if (a.sprint_status) rows = rows.filter(t => t.sprint_status === a.sprint_status);
    if (a.reopened_only) rows = rows.filter(t => t.is_reopened);
    if (a.weekly_update_overdue_only) rows = rows.filter(t => needsWeeklyUpdate(t, now));

    const personMatch = (p: { id: string; full_name: string; email: string } | null, q: string) => {
      const s = q.trim().toLowerCase();
      if (s === 'me') return p?.id === me.id;
      return !!p && (p.full_name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s));
    };
    if (a.created_by) rows = rows.filter(t => personMatch(t.reporter, a.created_by!));
    if (a.assignee) {
      rows = a.assignee.trim().toLowerCase() === 'unassigned'
        ? rows.filter(t => !t.assignee_id)
        : rows.filter(t => personMatch(t.assignee, a.assignee!));
    }
    if (a.search) {
      const q = a.search.trim().toLowerCase();
      rows = rows.filter(t =>
        [t.custom_id, t.lab_name, t.client_id, t.subject, t.description, t.latest_comment, t.freshdesk_id]
          .some(v => v?.toLowerCase().includes(q)));
    }

    const sort = a.sort ?? (a.queue === 'pending_product' ? 'priority' : 'updated_desc');
    rows = [...rows].sort((x, y) => {
      switch (sort) {
        case 'created_desc': return y.created_at.localeCompare(x.created_at);
        case 'created_asc': return x.created_at.localeCompare(y.created_at);
        case 'priority': return PRIORITY_ORDER[x.priority] - PRIORITY_ORDER[y.priority] || y.updated_at.localeCompare(x.updated_at);
        default: return y.updated_at.localeCompare(x.updated_at);
      }
    });

    const limit = a.limit ?? 25;
    return ok({
      matching: rows.length,
      showing: Math.min(limit, rows.length),
      visible_to_you_total: visibleTotal,
      tickets: rows.slice(0, limit).map(t => ticketSummary(t, now)),
    });
  });

  // ------------------------------------------------------------ get_ticket
  addTool(server, 'get_ticket', {
    title: 'Get a Flow ticket',
    description: 'Full details of one ticket: description, current stage, people, Jira link, the complete activity timeline, and exactly which actions the signed-in user is allowed to take on it.',
    inputSchema: { ticket_id: ticketIdField },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ ticket_id }) => {
    const t = await findTicket(ctx, ticket_id);
    const logs = await loadTimeline(ctx.db, t.id);
    return ok({
      ticket: ticketDetail(t),
      your_allowed_actions: allowedActions(ctx, t),
      timeline: logs.map(timelineEntry),
    });
  });

  // ------------------------------------------------------- needs_attention
  addTool(server, 'needs_attention', {
    title: 'What needs attention in Flow',
    description: 'Tickets (visible to the user) that need action: weekly product update overdue (7+ days in In Scope / In Progress with no update or Jira change), holds whose date has passed, Critical/High tickets waiting for product review, tickets returned to CS, and the oldest open tickets.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const now = new Date();
    const rows = await loadVisibleTickets(ctx);
    const open = rows.filter(t => t.status !== TicketStatus.CLOSED);
    const overdue = rows.filter(t => needsWeeklyUpdate(t, now))
      .sort((x, y) => lastActivityAt(x).getTime() - lastActivityAt(y).getTime());
    return ok({
      weekly_update_overdue: overdue.map(t => ticketSummary(t, now)),
      hold_date_passed: rows.filter(t => isHoldExpired(t, now)).map(t => ticketSummary(t, now)),
      urgent_waiting_for_product_review: rows
        .filter(t => t.status === TicketStatus.PENDING_PROD_REVIEW && (t.priority === Priority.CRITICAL || t.priority === Priority.HIGH))
        .sort((x, y) => PRIORITY_ORDER[x.priority] - PRIORITY_ORDER[y.priority] || x.created_at.localeCompare(y.created_at))
        .map(t => ticketSummary(t, now)),
      returned_to_cs: rows.filter(t => t.status === TicketStatus.RETURNED_TO_CS).map(t => ticketSummary(t, now)),
      oldest_open: [...open].sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(0, 10).map(t => ticketSummary(t, now)),
      note: 'Expired holds are moved back to Pending Product Review automatically the next time someone opens the Flow web app.',
    });
  });

  // ------------------------------------------------------- recent_activity
  addTool(server, 'recent_activity', {
    title: 'Recent activity across Flow',
    description:
      'One feed of everything that happened on Flow tickets in a time window: every comment, weekly update, stage change, ' +
      'priority/sprint/assignee change and Jira status sync, newest first, plus tickets created in that window and a short summary. ' +
      'Use it for "what happened / what changed / give me updates" questions. Only tickets the user can see are included. ' +
      'Default window: the last 2 days.',
    inputSchema: {
      days: z.number().int().min(1).max(90).optional().describe('Look back this many days from now (default 2). Ignored when since is given'),
      since: isoDay.optional().describe('Start date YYYY-MM-DD (India time, inclusive), e.g. last Monday'),
      until: isoDay.optional().describe('End date YYYY-MM-DD (inclusive). Default: now'),
      only_stage_changes: z.boolean().optional().describe('Only entries where the stage changed'),
      tickets: z.enum(['all', 'mine']).optional().describe('"mine" = tickets you created or are assigned to. Default: all you can see'),
      by: z.string().optional().describe('Only entries written by this person: "me", or part of a name'),
      client_id: z.string().optional().describe('Only tickets of this client ID'),
      limit: z.number().int().min(1).max(500).optional().describe('Max entries returned (default 100); the summary always counts everything'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (a) => {
    const now = new Date();
    const from = a.since ? getDateRange('custom', a.since, undefined, now).start : new Date(now.getTime() - (a.days ?? 2) * 86_400_000);
    const to = a.until ? getDateRange('custom', undefined, a.until, now).end : now;
    if (from > to) throw new UserFacingError('The start date is after the end date.');

    const [logs, tickets] = await Promise.all([loadActivity(ctx.db, from, to), loadVisibleTickets(ctx)]);
    const mine = (t: { reporter_id: string; assignee_id: string | null }) => t.reporter_id === me.id || t.assignee_id === me.id;
    const clientMatch = (cid: string) => !a.client_id || cid.trim().toLowerCase() === a.client_id.trim().toLowerCase();

    let entries = logs.filter(l => l.ticket && isTicketVisible(l.ticket, me.role, me.id));
    if (a.tickets === 'mine') entries = entries.filter(l => mine(l.ticket!));
    if (a.client_id) entries = entries.filter(l => clientMatch(l.ticket!.client_id));
    if (a.only_stage_changes) entries = entries.filter(l => l.previous_status !== l.new_status);
    if (a.by) {
      const q = a.by.trim().toLowerCase();
      entries = entries.filter(l => q === 'me' ? l.author_id === me.id : (l.author?.full_name ?? '').toLowerCase().includes(q));
    }

    const created = tickets.filter(t => {
      const c = new Date(t.created_at).getTime();
      return c >= from.getTime() && c <= to.getTime() && (a.tickets !== 'mine' || mine(t)) && clientMatch(t.client_id)
        && (!a.by || (a.by.trim().toLowerCase() === 'me' ? t.reporter_id === me.id : (t.reporter?.full_name ?? '').toLowerCase().includes(a.by.trim().toLowerCase())));
    }).sort((x, y) => y.created_at.localeCompare(x.created_at));

    const moves = entries.filter(l => l.previous_status !== l.new_status);
    const movedTo: Record<string, number> = {};
    for (const l of moves) movedTo[STATUS_LABELS[l.new_status]] = (movedTo[STATUS_LABELS[l.new_status]] ?? 0) + 1;
    const people: Record<string, number> = {};
    for (const l of entries) { const n = l.author?.full_name ?? 'Unknown'; people[n] = (people[n] ?? 0) + 1; }

    const limit = a.limit ?? 100;
    const newestFirst = [...entries].reverse();
    return ok({
      window: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        updates: entries.length,
        tickets_touched: new Set(entries.map(l => l.ticket_id)).size,
        new_tickets: created.length,
        stage_changes: moves.length,
        moved_to: movedTo,
        by_person: people,
      },
      new_tickets: created.map(t => ({ id: t.custom_id, lab: t.lab_name, subject: t.subject, priority: t.priority, created_by: t.reporter?.full_name ?? null, at: t.created_at })),
      showing: Math.min(limit, newestFirst.length),
      activity: newestFirst.slice(0, limit).map(l => ({
        ticket: l.ticket!.custom_id,
        lab: l.ticket!.lab_name,
        subject: l.ticket!.subject,
        current_stage: stageLabel(l.ticket!),
        ...timelineEntry(l),
      })),
    });
  });

  // --------------------------------------------------------- get_analytics
  addTool(server, 'get_analytics', {
    title: 'Flow analytics',
    description: 'The numbers from the Flow Analytics page for a period: totals, open/resolved/closed, reopen rate, turnaround times (In Scope→Resolved, Resolved→Closed, Created→Closed), SLA breaches, breakdown by type and priority, current stage pipeline, monthly raised vs resolved, top clients and per-CSM workload. Available to CS Lead, Product Lead, Product Team and Admin. Period boundaries use India time.',
    inputSchema: {
      period: z.enum(['this_week', 'mtd', 'ytd', 'all_time', 'custom']).optional().describe('Default all_time. mtd = month to date, ytd = year to date'),
      start_date: isoDay.optional().describe('For period=custom (inclusive)'),
      end_date: isoDay.optional().describe('For period=custom (inclusive)'),
      top_clients: z.number().int().min(1).max(50).optional().describe('How many top clients to return (default 10)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (a) => {
    if (!ANALYTICS_ROLES.includes(me.role)) {
      throw new UserFacingError(`Analytics are available to CS Lead, Product Lead, Product Team and Admin — not ${ROLE_LABELS[me.role]}.`);
    }
    const period = (a.period ?? 'all_time') as TimePeriod;
    const range = getDateRange(period, a.start_date, a.end_date);
    const [all, logs] = await Promise.all([
      loadAllTickets(ctx.db),
      fetchAll<Pick<LogRow, 'ticket_id' | 'previous_status' | 'new_status' | 'created_at'>>(() =>
        ctx.db.from('update_logs').select('ticket_id, previous_status, new_status, created_at')
          .order('created_at', { ascending: true }).order('id')),
    ]);
    return ok(computeAnalytics(all, logs, range, a.top_clients ?? 10, period));
  });

  // ---------------------------------------------------- list_product_users
  addTool(server, 'list_product_users', {
    title: 'List people tickets can be assigned to',
    description: 'Product Lead / Product Team / Admin users — the people a ticket can be assigned to.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const users = await loadProductUsers(ctx.db);
    return ok(users.map(u => ({ name: u.full_name, email: u.email, role: ROLE_LABELS[u.role] })));
  });

  // ========================================================== WRITE TOOLS

  // --------------------------------------------------------- create_ticket
  addTool(server, 'create_ticket', {
    title: 'Create a Flow escalation',
    description: 'Creates a new escalation ticket in "New Escalation" (Pending CS Triage), reported by the signed-in user. Allowed for CS Manager, CS Lead and Admin. Confirm the details with the user before calling.',
    inputSchema: {
      lab_name: z.string().min(1).describe('Lab / client name'),
      client_id: z.string().min(1).describe('Client ID, e.g. CL-2045'),
      subject: z.string().min(1).max(300).describe('Short issue title'),
      description: z.string().optional().describe('Full description of the issue'),
      type: subTypeEnum.describe('BUG, ENHANCEMENT, FEATURE_REQUEST or BACKEND_CONFIG'),
      priority: priorityEnum.optional().describe('Default MEDIUM'),
      jira: z.string().optional().describe('Jira key (e.g. EA-1234) or Jira/Freshdesk URL'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    if (!CREATE_ROLES.includes(me.role)) {
      throw new UserFacingError(`Only CS Manager, CS Lead and Admin can create tickets — you are ${ROLE_LABELS[me.role]}.`);
    }
    const { data, error } = await ctx.db.from('tickets').insert([{
      lab_name: a.lab_name.trim(),
      client_id: a.client_id.trim(),
      subject: a.subject.trim(),
      description: (a.description ?? '').trim(),
      sub_type: a.type,
      priority: a.priority ?? Priority.MEDIUM,
      freshdesk_id: normalizeJiraInput(a.jira) || null,
      reporter_id: me.id,
      status: TicketStatus.NEW_ESCALATION,
      last_product_activity_at: new Date().toISOString(),
    }]).select('custom_id').single();
    if (error) throw dbError(error, 'create the ticket');
    const created = await findTicket(ctx, data.custom_id);
    return ok({ created: ticketDetail(created) });
  });

  // ----------------------------------------------------------- add_comment
  addTool(server, 'add_comment', {
    title: 'Comment on a Flow ticket',
    description: 'Adds a comment to a ticket\'s timeline (and makes it the "latest comment"). Does not change the stage or reset the weekly-update clock — use post_weekly_update for that.',
    inputSchema: { ticket_id: ticketIdField, comment: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ ticket_id, comment }) => {
    const t = await findTicket(ctx, ticket_id);
    const text = comment.trim();
    if (!text) throw new UserFacingError('Comment cannot be empty.');
    await updateTicketRow(ctx, t, { latest_comment: text }, 'add the comment');
    await insertLog(ctx, t.id, t.status, t.status, tagged(text), null);
    return ok({ ticket: t.custom_id, commented: text });
  });

  // ---------------------------------------------------- post_weekly_update
  addTool(server, 'post_weekly_update', {
    title: 'Post weekly product update',
    description: 'Posts a progress update on a ticket in Pending Product Review, In Product Scope or In Progress. This resets the 7-day weekly-update (SLA) clock. Allowed for CS Lead, Product Lead, Product Team and Admin.',
    inputSchema: { ticket_id: ticketIdField, update: z.string().min(1).describe('What changed / current progress') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ ticket_id, update }) => {
    const t = await findTicket(ctx, ticket_id);
    if (!canPostUpdate(t.status, me.role)) {
      throw new UserFacingError(
        ALL_ACTION_ROLES.includes(me.role)
          ? `Weekly updates can only be posted while a ticket is Pending Product Review, In Product Scope or In Progress — ${t.custom_id} is ${stageLabel(t)}.`
          : `A ${ROLE_LABELS[me.role]} can't post weekly updates.`,
      );
    }
    const text = update.trim();
    await updateTicketRow(ctx, t, { last_product_activity_at: new Date().toISOString(), latest_comment: text }, 'post the update');
    await insertLog(ctx, t.id, t.status, t.status, tagged(text), null);
    return ok({ ticket: t.custom_id, posted: text, weekly_update_clock_reset: true });
  });

  // --------------------------------------------------------- update_ticket
  addTool(server, 'update_ticket', {
    title: 'Update a Flow ticket',
    description:
      'Changes one or more of: stage, priority, sprint status, assignee — saved together as one timeline entry, exactly like "Save All Changes" in the web app. ' +
      'A comment is required when changing the stage, and hold_until is required when moving to ON_HOLD_UNTIL. ' +
      'Call get_ticket first to see which stages this user may move the ticket to. Confirm with the user before calling. ' +
      `Stage codes: ${STAGE_GUIDE}.`,
    inputSchema: {
      ticket_id: ticketIdField,
      move_to_stage: stageEnum.optional().describe('New stage code'),
      comment: z.string().optional().describe('Reason / note. Required when changing stage'),
      hold_until: isoDay.optional().describe('YYYY-MM-DD, required for ON_HOLD_UNTIL; must be today or later'),
      priority: priorityEnum.optional(),
      sprint_status: sprintEnum.optional(),
      assignee: z.string().optional().describe('Name or email of a Product user (see list_product_users), or "unassigned"'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const t = await findTicket(ctx, a.ticket_id);
    const comment = (a.comment ?? '').trim();
    const current = t.status;
    const update: Record<string, unknown> = {};
    const parts: string[] = [];
    let finalStatus = current;
    let holdIso: string | null = null;

    // ---- stage
    if (a.move_to_stage && a.move_to_stage !== current) {
      const target = a.move_to_stage;
      if (!canTransition(current, target, me.role, me.id, t.reporter_id)) {
        const allowed = getAvailableTransitions(current, me.role, me.id, t.reporter_id).map(s => STATUS_LABELS[s]);
        throw new UserFacingError(
          `You can't move ${t.custom_id} from ${STATUS_LABELS[current]} to ${STATUS_LABELS[target]}. ` +
          (allowed.length ? `Stages you can move it to: ${allowed.join(', ')}.` : `As ${ROLE_LABELS[me.role]} you can't change this ticket's stage.`),
        );
      }
      if (!comment) throw new UserFacingError('A comment is required when changing the stage.');
      update.status = target;
      finalStatus = target;
      if (target === TicketStatus.ON_HOLD_UNTIL) {
        if (!a.hold_until) throw new UserFacingError('hold_until (YYYY-MM-DD) is required when putting a ticket On Hold.');
        if (a.hold_until < todayIST()) throw new UserFacingError('hold_until must be today or a future date.');
        holdIso = new Date(`${a.hold_until}T00:00:00.000Z`).toISOString(); // same as the web app's date picker
        update.hold_until_date = holdIso;
      } else {
        update.hold_until_date = null;
      }
      if (PRODUCT_ACTIVITY_STATUSES.includes(target)) update.last_product_activity_at = new Date().toISOString();
      if (isReopenTransition(current, target)) {
        update.is_reopened = true;
        update.reopen_count = (t.reopen_count ?? 0) + 1;
      }
      if (SPRINT_CLEARING_STATUSES.includes(target)) update.sprint_status = null;
    } else if (a.hold_until) {
      throw new UserFacingError('hold_until only applies when moving the ticket to ON_HOLD_UNTIL.');
    }

    // ---- priority
    if (a.priority && a.priority !== t.priority) {
      if (!canChangePriority(me.role, t.sprint_status)) {
        throw new UserFacingError(`${t.custom_id} is In Sprint — only CS Lead, Product Lead, Product Team or Admin can change its priority.`);
      }
      update.priority = a.priority;
      parts.push(`Priority → ${a.priority}`);
    }

    // ---- sprint status
    if (a.sprint_status && a.sprint_status !== t.sprint_status) {
      if (!canChangeSprintStatus(current, me.role)) {
        throw new UserFacingError(
          ALL_ACTION_ROLES.includes(me.role)
            ? `Sprint status can only be set while a ticket is Pending Product Review, In Product Scope or In Progress — ${t.custom_id} is ${stageLabel(t)}.`
            : `A ${ROLE_LABELS[me.role]} can't change sprint status.`,
        );
      }
      if (update.sprint_status === null) {
        throw new UserFacingError(`Moving to ${STATUS_LABELS[finalStatus]} clears the sprint status, so it can't be set in the same update.`);
      }
      update.sprint_status = a.sprint_status;
      parts.push(`Sprint → ${a.sprint_status.replace('_', ' ')}`); // same wording as the web app
    }

    // ---- assignee
    if (a.assignee !== undefined && a.assignee.trim() !== '') {
      if (!canChangeAssignee(me.role)) {
        throw new UserFacingError('Only Product Lead, Product Team and Admin can assign tickets.');
      }
      const q = a.assignee.trim().toLowerCase();
      if (q === 'unassigned' || q === 'none') {
        if (t.assignee_id) {
          update.assignee_id = null;
          parts.push('Unassigned');
        }
      } else {
        const users = await loadProductUsers(ctx.db);
        const exact = users.filter(u => u.email.toLowerCase() === q || u.full_name.toLowerCase() === q || u.id === a.assignee!.trim());
        const matches = exact.length ? exact : users.filter(u => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
        if (matches.length === 0) throw new UserFacingError(`No Product user matches "${a.assignee}". Use list_product_users to see who can be assigned.`);
        if (matches.length > 1) throw new UserFacingError(`"${a.assignee}" matches several people: ${matches.map(u => `${u.full_name} <${u.email}>`).join(', ')}. Please be more specific.`);
        if (matches[0].id !== t.assignee_id) {
          update.assignee_id = matches[0].id;
          parts.push(`Assigned to ${matches[0].full_name}`);
        }
      }
    }

    if (Object.keys(update).length === 0) {
      throw new UserFacingError('Nothing to change — the ticket already has those values. (To just add a note, use add_comment.)');
    }

    if (comment) {
      update.latest_comment = comment;
      parts.push(comment);
    }
    await updateTicketRow(ctx, t, update, `update ${t.custom_id}`);
    await insertLog(ctx, t.id, current, finalStatus, tagged(parts.join(' | ') || 'Batch update'), holdIso);

    const after = await findTicket(ctx, t.custom_id).catch(() => null);
    return ok({
      ticket: t.custom_id,
      stage_change: finalStatus !== current ? `${STATUS_LABELS[current]} → ${STATUS_LABELS[finalStatus]}` : undefined,
      changes: parts,
      now: after ? ticketSummary(after) : 'Saved. (The ticket is no longer visible to your role at its new stage.)',
    });
  });

  // --------------------------------------------------- edit_ticket_details
  addTool(server, 'edit_ticket_details', {
    title: 'Edit a Flow ticket\'s details',
    description:
      'Fixes the details of an existing ticket: subject, description, lab / client name and client ID. ' +
      'Does not change the stage (use update_ticket) or the Jira link (use link_jira). ' +
      'Allowed for the person who raised the ticket, CS Lead and Admin. The old and new values are written to the ticket timeline. ' +
      'Confirm the exact new text with the user before calling.',
    inputSchema: {
      ticket_id: ticketIdField,
      subject: z.string().min(1).max(300).optional().describe('New subject (short title)'),
      description: z.string().optional().describe('New full description (replaces the old one)'),
      lab_name: z.string().min(1).optional().describe('New lab / client name'),
      client_id: z.string().min(1).optional().describe('New client ID'),
      reason: z.string().optional().describe('Why it changed, e.g. "wrong client ID"'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const t = await findTicket(ctx, a.ticket_id);
    if (!canEditDetails(me.role, me.id, t.reporter_id)) {
      throw new UserFacingError(`Only the person who raised ${t.custom_id}, a CS Lead or an Admin can edit its details.`);
    }
    const update: Record<string, unknown> = {};
    const parts: string[] = [];
    const quote = (v: string) => `"${v.length > 80 ? v.slice(0, 79) + '…' : v}"`;
    const field = (key: 'subject' | 'lab_name' | 'client_id', label: string, value: string | undefined) => {
      if (value === undefined) return;
      const v = value.trim();
      if (!v) throw new UserFacingError(`${label} can't be empty.`);
      if (v === (t[key] ?? '').trim()) return;
      update[key] = v;
      parts.push(`${label}: ${quote(t[key] || '—')} → ${quote(v)}`);
    };
    field('subject', 'Subject', a.subject);
    field('lab_name', 'Lab / client', a.lab_name);
    field('client_id', 'Client ID', a.client_id);
    if (a.description !== undefined && a.description.trim() !== (t.description ?? '').trim()) {
      update.description = a.description.trim();
      parts.push('Description updated');
    }
    if (parts.length === 0) {
      throw new UserFacingError('Nothing to change — the ticket already has those details.');
    }
    await updateTicketRow(ctx, t, update, `edit ${t.custom_id}`);
    const reason = (a.reason ?? '').trim();
    await insertLog(ctx, t.id, t.status, t.status, tagged(`Details edited: ${parts.join(' | ')}${reason ? ` | ${reason}` : ''}`), null);
    const after = await findTicket(ctx, t.custom_id);
    return ok({ ticket: t.custom_id, changes: parts, now: ticketDetail(after) });
  });

  // ------------------------------------------------------------- link_jira
  addTool(server, 'link_jira', {
    title: 'Link a Jira ticket to a Flow ticket',
    description:
      'Sets, replaces or removes the Jira (or Freshdesk) link on an existing Flow ticket. Accepts a Jira key like EA-1234, ' +
      'a Jira or Freshdesk URL, or "none" to remove the link. Jira keys become crelio.atlassian.net links, the same as in the web app. ' +
      'Allowed for the person who raised the ticket, CS Lead, Product Lead, Product Team and Admin. The change is written to the timeline; ' +
      'the Jira status column refreshes the next time someone opens the Flow web app.',
    inputSchema: {
      ticket_id: ticketIdField,
      jira: z.string().min(1).describe('Jira key (EA-1234), Jira/Freshdesk URL, or "none" to remove the link'),
      reason: z.string().optional().describe('Optional note for the timeline'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    const t = await findTicket(ctx, a.ticket_id);
    if (!canLinkJira(me.role, me.id, t.reporter_id)) {
      throw new UserFacingError(`Only the person who raised ${t.custom_id}, a CS Lead, Product or an Admin can change its Jira link.`);
    }
    const raw = a.jira.trim();
    const remove = /^(none|remove|unlink|-)$/i.test(raw);
    let link: string | null = null;
    if (!remove) {
      const isUrl = /^https?:\/\//i.test(raw);
      if (!isUrl && !/^[A-Z][A-Z0-9]+-\d+$/i.test(raw)) {
        throw new UserFacingError(`"${raw}" isn't a Jira key (like EA-1234) or a link. Use a key, a full Jira/Freshdesk URL, or "none".`);
      }
      link = normalizeJiraInput(raw);
    }
    const label = (v: string | null) => (v ? (extractJiraKey(v) ?? v) : 'none');
    if ((link ?? null) === (t.freshdesk_id ?? null)) {
      throw new UserFacingError(`${t.custom_id} is already linked to ${label(link)}.`);
    }
    await updateTicketRow(ctx, t, {
      freshdesk_id: link,
      // The stored Jira status belonged to the old link; the web app's sync fills in the new one.
      jira_status: null,
      last_jira_status_change_at: null,
    }, `change the Jira link on ${t.custom_id}`);
    const reason = (a.reason ?? '').trim();
    const what = link ? (t.freshdesk_id ? `Jira link changed: ${label(t.freshdesk_id)} → ${label(link)}` : `Jira linked: ${label(link)}`) : `Jira link removed (was ${label(t.freshdesk_id)})`;
    await insertLog(ctx, t.id, t.status, t.status, tagged(`${what}${reason ? ` | ${reason}` : ''}`), null);
    return ok({ ticket: t.custom_id, change: what, jira_link: link });
  });
}

// ===== Write helpers =====

async function updateTicketRow(ctx: Ctx, t: TicketRow, values: Record<string, unknown>, action: string) {
  // .select() makes a silently-blocked update (RLS USING clause → 0 rows) visible.
  const { data, error } = await ctx.db.from('tickets').update(values).eq('id', t.id).select('id');
  if (error) throw dbError(error, action);
  if (!data || data.length === 0) {
    throw new UserFacingError(`The database refused to ${action} — your role isn't allowed to change this ticket.`);
  }
}

async function insertLog(ctx: Ctx, ticketId: string, prev: TicketStatus, next: TicketStatus, comment: string, hold: string | null) {
  const { error } = await ctx.db.from('update_logs').insert([{
    ticket_id: ticketId,
    author_id: ctx.me.id,
    comment,
    previous_status: prev,
    new_status: next,
    hold_target_date: hold,
  }]);
  if (error) throw dbError(error, 'write the timeline entry (the ticket itself was updated)');
}

// ===== Analytics (mirror of src/lib/analytics.ts) =====

type LiteLog = Pick<LogRow, 'ticket_id' | 'previous_status' | 'new_status' | 'created_at'>;

export function computeAnalytics(
  all: TicketRow[], logs: LiteLog[], range: { start: Date; end: Date }, topN: number, period: string, now = new Date(),
) {
  const inRange = all.filter(t => {
    const c = new Date(t.created_at).getTime();
    return c > range.start.getTime() && c <= range.end.getTime();
  });
  const logsByTicket = new Map<string, LiteLog[]>();
  for (const l of logs) {
    const list = logsByTicket.get(l.ticket_id) ?? [];
    list.push(l);
    logsByTicket.set(l.ticket_id, list);
  }
  const firstLog = (ticketId: string, status: TicketStatus) =>
    (logsByTicket.get(ticketId) ?? []).find(l => l.new_status === status);
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
  const isResolved = (s: string) => s === TicketStatus.RESOLVED || s === TicketStatus.RESOLVED_BY_CS;

  // Stat cards
  const resolution: number[] = [], closure: number[] = [], e2e: number[] = [];
  for (const t of inRange) {
    const scope = firstLog(t.id, TicketStatus.IN_PRODUCT_SCOPE);
    const resolved = firstLog(t.id, TicketStatus.RESOLVED);
    const closed = firstLog(t.id, TicketStatus.CLOSED);
    if (scope && resolved) { const h = hoursBetween(scope.created_at, resolved.created_at); if (h >= 0) resolution.push(h); }
    if (resolved && closed) { const h = hoursBetween(resolved.created_at, closed.created_at); if (h >= 0) closure.push(h); }
    if (t.status === TicketStatus.CLOSED && closed) { const h = hoursBetween(t.created_at, closed.created_at); if (h >= 0) e2e.push(h); }
  }
  const reopened = inRange.filter(t => t.is_reopened).length;
  const slaBreachesNow = all.filter(t =>
    (t.status === TicketStatus.IN_PRODUCT_SCOPE || t.status === TicketStatus.IN_PROGRESS) &&
    daysBetween(t.last_product_activity_at, now) > 7).length;

  const count = <K extends string>(items: TicketRow[], key: (t: TicketRow) => K) => {
    const m: Record<string, number> = {};
    for (const t of items) m[key(t)] = (m[key(t)] ?? 0) + 1;
    return m;
  };

  // Monthly raised vs resolved
  const monthKey = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 7);
  const months: Record<string, { raised: number; resolved: number }> = {};
  for (const t of inRange) (months[monthKey(t.created_at)] ??= { raised: 0, resolved: 0 }).raised++;
  for (const l of logs) {
    // Only real stage changes count (a comment on a resolved ticket also has new_status = RESOLVED).
    if (l.previous_status !== l.new_status && isResolved(l.new_status)) (months[monthKey(l.created_at)] ??= { raised: 0, resolved: 0 }).resolved++;
  }

  // Clients (grouped by client ID like the web app)
  const byClient = new Map<string, TicketRow[]>();
  for (const t of inRange) {
    const k = t.client_id || 'NO_ID';
    byClient.set(k, [...(byClient.get(k) ?? []), t]);
  }
  const clients = [...byClient.entries()].map(([clientId, ts]) => {
    const closedTats = ts.filter(t => t.status === TicketStatus.CLOSED)
      .map(t => { const c = firstLog(t.id, TicketStatus.CLOSED); return c ? hoursBetween(t.created_at, c.created_at) : null; })
      .filter((h): h is number => h !== null);
    return {
      client: ts[0]?.lab_name || clientId,
      client_id: clientId,
      total: ts.length,
      open: ts.filter(t => t.status !== TicketStatus.CLOSED).length,
      closed: ts.filter(t => t.status === TicketStatus.CLOSED).length,
      reopens: ts.reduce((s, t) => s + (t.reopen_count ?? 0), 0),
      avg_created_to_closed: formatTAT(avg(closedTats)),
      by_type: count(ts, t => SUB_TYPE_LABELS[t.sub_type]),
      by_priority: count(ts, t => t.priority),
    };
  }).sort((x, y) => y.total - x.total);

  // CSM workload
  const byReporter = new Map<string, TicketRow[]>();
  for (const t of inRange) byReporter.set(t.reporter_id, [...(byReporter.get(t.reporter_id) ?? []), t]);
  const workload = [...byReporter.values()].map(ts => ({
    name: ts[0].reporter?.full_name ?? 'Unknown',
    total: ts.length,
    ...count(ts, t => SUB_TYPE_LABELS[t.sub_type]),
  })).sort((x, y) => y.total - x.total);

  const pipelineOrder = [
    TicketStatus.NEW_ESCALATION, TicketStatus.PENDING_PROD_REVIEW, TicketStatus.IN_PRODUCT_SCOPE, TicketStatus.IN_PROGRESS,
    TicketStatus.ON_HOLD_UNTIL, TicketStatus.RETURNED_TO_CS, TicketStatus.RESOLVED, TicketStatus.RESOLVED_BY_CS, TicketStatus.CLOSED,
  ];

  return {
    period,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
    totals_for_period: {
      raised: inRange.length,
      closed: inRange.filter(t => t.status === TicketStatus.CLOSED).length,
      reopen_rate_percent: inRange.length ? Math.round((reopened / inRange.length) * 100) : 0,
      avg_in_scope_to_resolved: formatTAT(avg(resolution)),
      avg_resolved_to_closed: formatTAT(avg(closure)),
      avg_created_to_closed: formatTAT(avg(e2e)),
    },
    right_now_all_tickets: {
      open: all.filter(t => t.status !== TicketStatus.CLOSED && !isResolved(t.status)).length,
      resolved_not_closed: all.filter(t => isResolved(t.status)).length,
      sla_breaches: slaBreachesNow,
      stage_pipeline: Object.fromEntries(pipelineOrder.map(s => [STATUS_LABELS[s], all.filter(t => t.status === s).length])),
    },
    by_type: count(inRange, t => SUB_TYPE_LABELS[t.sub_type]),
    by_priority: Object.fromEntries([Priority.CRITICAL, Priority.HIGH, Priority.MEDIUM, Priority.LOW]
      .map(p => [p, inRange.filter(t => t.priority === p).length])),
    monthly_raised_vs_resolved: Object.entries(months).sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v })),
    top_clients: clients.slice(0, topN),
    csm_workload: workload,
    sprint_status_counts: Object.fromEntries(Object.values(SprintStatus)
      .map(s => [SPRINT_STATUS_LABELS[s], all.filter(t => t.sprint_status === s).length])),
  };
}
