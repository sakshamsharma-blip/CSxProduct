const JIRA_DOMAIN = 'crelio.atlassian.net';

/**
 * Normalizes a JIRA input to a full URL.
 * - If it's already a full URL (contains http), return as-is.
 * - If it's just a ticket key (e.g. "EA-1234", "EN-456"), construct the full browse URL.
 * - If empty/null, return null.
 */
export function normalizeJiraInput(input: string | null | undefined): string | null {
  if (!input || !input.trim()) return null;

  const trimmed = input.trim();

  // Already a full URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Check if it matches a JIRA ticket key pattern (e.g. EA-1234, EN-56, PROJ-789)
  const keyMatch = trimmed.match(/^([A-Z][A-Z0-9]+-\d+)$/i);
  if (keyMatch) {
    const key = keyMatch[1].toUpperCase();
    return `https://${JIRA_DOMAIN}/browse/${key}`;
  }

  // Might be just a number or partial — try wrapping common prefixes
  // If it doesn't match anything, store as-is (user can fix later)
  return trimmed;
}

/**
 * Extracts a JIRA issue key from a URL or raw input.
 * Supports:
 *   - https://crelio.atlassian.net/browse/EA-14528
 *   - https://crelio.atlassian.net/jira/software/...?selectedIssue=EA-14528
 *   - EA-14528 (raw key)
 */
export function extractJiraKey(input: string | null): string | null {
  if (!input) return null;
  const match = input.match(/([A-Z][A-Z0-9]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Builds a clickable JIRA URL from any input (key or full URL).
 */
export function getJiraUrl(input: string | null): string | null {
  if (!input) return null;
  const normalized = normalizeJiraInput(input);
  return normalized;
}

/**
 * The ID people should see for a ticket: the Jira key (EA-1234, EN-567…)
 * when one is linked, otherwise Flow's own REQ-#### ID.
 */
export function displayId(ticket: { custom_id: string; freshdesk_id: string | null }): string {
  return extractJiraKey(ticket.freshdesk_id) ?? ticket.custom_id;
}

/** True when the input is a Jira key like EA-1234 (and not a Flow REQ-#### ID). */
export function isJiraKey(input: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(input.trim()) && !/^REQ-/i.test(input.trim());
}

/**
 * Duplicate rule: the same Jira key on more than one Flow ticket that is not Closed.
 * Returns key → the open tickets sharing it (only keys with 2+ tickets).
 * Pass ALL tickets (not just the ones the current user's list shows).
 */
export function findDuplicateGroups<T extends { status: string; freshdesk_id: string | null }>(tickets: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const t of tickets) {
    if (t.status === 'CLOSED') continue;
    const k = extractJiraKey(t.freshdesk_id);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const [k, list] of groups) if (list.length < 2) groups.delete(k);
  return groups;
}
