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
