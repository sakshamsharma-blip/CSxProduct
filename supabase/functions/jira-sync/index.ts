// Supabase Edge Function: jira-sync
// Fetches the current status of a JIRA ticket given its URL.
// Called from the frontend on page load for tickets with JIRA links.
//
// Deploy with: supabase functions deploy jira-sync
// Set secrets:
//   supabase secrets set JIRA_EMAIL=saksham.sharma@livehealth.in
//   supabase secrets set JIRA_API_TOKEN=your-jira-api-token
//   supabase secrets set JIRA_DOMAIN=crelio.atlassian.net

import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { jira_url } = await req.json()

    if (!jira_url) {
      return new Response(
        JSON.stringify({ error: 'jira_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const jiraEmail = Deno.env.get('JIRA_EMAIL') ?? ''
    const jiraToken = Deno.env.get('JIRA_API_TOKEN') ?? ''
    const jiraDomain = Deno.env.get('JIRA_DOMAIN') ?? 'crelio.atlassian.net'

    if (!jiraEmail || !jiraToken) {
      return new Response(
        JSON.stringify({ error: 'JIRA credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract issue key from URL
    // Supports: https://crelio.atlassian.net/browse/EA-14528
    //           https://crelio.atlassian.net/jira/software/projects/EA/boards/1?selectedIssue=EA-14528
    const issueKey = extractIssueKey(jira_url)

    if (!issueKey) {
      return new Response(
        JSON.stringify({ error: 'Could not extract JIRA issue key from URL', jira_url }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call JIRA REST API
    const auth = btoa(`${jiraEmail}:${jiraToken}`)
    const apiUrl = `https://${jiraDomain}/rest/api/3/issue/${issueKey}?fields=status,summary,assignee`

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `JIRA API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()

    return new Response(
      JSON.stringify({
        key: data.key,
        status: data.fields?.status?.name || 'Unknown',
        summary: data.fields?.summary || '',
        assignee: data.fields?.assignee?.displayName || null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function extractIssueKey(url: string): string | null {
  // Pattern 1: /browse/EA-14528
  const browseMatch = url.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/)
  if (browseMatch) return browseMatch[1]

  // Pattern 2: ?selectedIssue=EA-14528
  const selectedMatch = url.match(/selectedIssue=([A-Z][A-Z0-9]+-\d+)/)
  if (selectedMatch) return selectedMatch[1]

  // Pattern 3: just the key in the URL path somewhere
  const genericMatch = url.match(/([A-Z][A-Z0-9]+-\d+)/)
  if (genericMatch) return genericMatch[1]

  return null
}
