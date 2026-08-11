import { supabase } from './supabase';
import { Ticket } from '../types';
import { normalizeJiraInput } from './jiraUtils';

/**
 * For each ticket with a JIRA link, fetch current status from the jira-sync Edge Function.
 * If the status has changed:
 *   - Update jira_status and last_jira_status_change_at on the ticket
 *   - Create an audit log entry showing the JIRA status transition
 * Called once on page load — does not block the UI.
 */
export async function syncJiraStatuses(tickets: Ticket[]) {
  const ticketsWithJira = tickets.filter(t => {
    if (!t.freshdesk_id) return false;
    // Match full atlassian URLs or raw JIRA keys (e.g. EA-1234)
    return t.freshdesk_id.includes('atlassian') || /^[A-Z][A-Z0-9]+-\d+$/i.test(t.freshdesk_id.trim());
  });

  if (ticketsWithJira.length === 0) return;

  // Process in parallel, max 5 at a time
  const batchSize = 5;
  for (let i = 0; i < ticketsWithJira.length; i += batchSize) {
    const batch = ticketsWithJira.slice(i, i + batchSize);

    await Promise.allSettled(
      batch.map(async (ticket) => {
        try {
          const { data, error } = await supabase.functions.invoke('jira-sync', {
            body: { jira_url: normalizeJiraInput(ticket.freshdesk_id) },
          });

          if (error || !data || data.error) return;

          const newJiraStatus = data.status as string;
          const oldJiraStatus = ticket.jira_status;

          // Only act if status actually changed (not same → same)
          if (!newJiraStatus || newJiraStatus === oldJiraStatus) return;

          // Update ticket with new JIRA status + timestamp
          await supabase
            .from('tickets')
            .update({
              jira_status: newJiraStatus,
              last_jira_status_change_at: new Date().toISOString(),
            })
            .eq('id', ticket.id);

          // Create audit log entry for the JIRA status change
          await supabase
            .from('update_logs')
            .insert([{
              ticket_id: ticket.id,
              author_id: ticket.reporter_id, // System action, attributed to reporter
              comment: oldJiraStatus
                ? `JIRA status changed: ${oldJiraStatus} → ${newJiraStatus}`
                : `JIRA status synced: ${newJiraStatus}`,
              previous_status: ticket.status,
              new_status: ticket.status, // No Flow status change
              hold_target_date: null,
            }]);
        } catch {
          // Silently fail — JIRA sync is non-critical
        }
      })
    );
  }
}
