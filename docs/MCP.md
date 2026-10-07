# Flow MCP server — use Flow from Claude

The Flow MCP server lets anyone on the team work with Flow tickets by talking to Claude, for example:

- "What needs my attention in Flow today?"
- "Show me all Critical tickets waiting for product review"
- "Move REQ-1042 to In Progress, put it in this sprint and assign it to Esha"
- "Post a weekly update on REQ-1003: dev is 60% done, QA next week"
- "Log a new bug for Metro Labs (CL-2045): barcode not printing in Bill Wise"

Claude acts **as the person who connected it**: their role, their visibility and the same database rules as the web app. A CS Manager using Claude can do exactly what they could do in the browser, and nothing more.

---

## How it works

```
Claude ──(MCP over HTTPS + Bearer token)──▶ Supabase Edge Function "flow-mcp"
   │                                             │  runs every query with the
   │ 1st time: "Connect"                         │  user's own token → RLS applies
   ▼                                             ▼
Supabase Auth OAuth 2.1 server ──▶ Flow web app /oauth/consent ──▶ Postgres (tickets, update_logs, app_users)
 (registers Claude, issues tokens)   (log in + "Allow")
```

| Piece | Where | What it does |
|---|---|---|
| MCP server | `supabase/functions/flow-mcp/` | The tools Claude can call. Checks the token, finds the person's Flow profile (including linked @livehealth.in / @creliohealth.com logins), and runs every read/write with that person's token. |
| Rules mirror | `supabase/functions/_shared/flowRules.ts` | Copy of the web app's role/stage rules so Claude gets clear "you can't do that" messages. The database (RLS, migration 006) still has the final say. |
| Sign-in | Supabase Auth → OAuth Server (built in) | Handles Claude's registration, login redirect and tokens. Nothing to host. |
| Consent page | `src/pages/OAuthConsentPage.tsx` at `/oauth/consent` | "Allow Claude to use Flow as you?" — uses the normal Flow login first. |
| Drift check | `scripts/check-mcp-rules.ts` | Fails if the web app rules and the MCP copy ever disagree. |

## Tools

| Tool | What it does | Who |
|---|---|---|
| `whoami` | Shows the signed-in account, role and what it can do | Everyone |
| `list_tickets` | Search/filter tickets (queue = web-app tab, priority, type, client, creator, assignee, sprint, reopened, weekly update overdue) | Everyone (sees what they see in the app) |
| `get_ticket` | One ticket: details, full timeline, and **which actions you're allowed to take on it** | Everyone |
| `needs_attention` | Weekly update overdue, hold date passed, Critical/High waiting for review, returned to CS, oldest open | Everyone |
| `recent_activity` | One feed of every comment, update and stage change (plus new tickets) in a time window, with a summary. Same data as the web app's **Activity** page | Everyone (only tickets they can see) |
| `get_analytics` | Same numbers as the Analytics page for a period (this week / month to date / year to date / all time / custom dates) | CS Lead, Product Lead, Product Team, Admin |
| `list_product_users` | People a ticket can be assigned to | Everyone |
| `create_ticket` | New escalation in "New Escalation" | CS Manager, CS Lead, Admin |
| `add_comment` | Comment on the timeline | Everyone (on tickets they can see) |
| `post_weekly_update` | Progress update; resets the 7-day weekly-update clock | CS Lead, Product Lead, Product Team, Admin |
| `update_ticket` | Stage / priority / sprint / assignee in one save, like "Save All Changes" | Same rules as the web app |
| `edit_ticket_details` | Fix subject, description, lab name or client ID; old → new is written to the timeline | Ticket creator, CS Lead, Admin |
| `link_jira` | Add, replace or remove the Jira / Freshdesk link (a key like EA-1234 or a URL) | Ticket creator, CS Lead, Product Lead, Product Team, Admin |

Not included on purpose: **Revert last action**, user management, and anything that bypasses roles.

Every timeline entry written through Claude ends with **"(via Claude)"** so it's clear where it came from. To change or remove the tag, set the `FLOW_MCP_AUDIT_TAG` secret (empty = no tag).

---

## One-time setup (about 10 minutes)

### 1. Turn on Supabase's OAuth server
Supabase dashboard → your Flow project → **Authentication → OAuth Server**:
- **Enable** the OAuth 2.1 server (it's a beta feature, free on all plans).
- **Authorization Path:** `/oauth/consent`
- **Allow dynamic client registration:** on (Claude registers itself the first time someone connects).

Then **Authentication → URL Configuration → Site URL** must be the Flow web app's real address (your Vercel URL, not `localhost`). Supabase builds the consent link as *Site URL + Authorization Path*.

### 2. Deploy the web app
Merge this branch so Vercel deploys the new `/oauth/consent` page. (`vercel.json` already sends every path to the app.)

### 3. Deploy the MCP function
```bash
supabase functions deploy flow-mcp --no-verify-jwt
```
`--no-verify-jwt` is required: the first request from Claude has no token yet, and the function itself must answer it with the "please sign in here" response. The function does its own token check on every other request.

The connector URL is:
```
https://<project-ref>.supabase.co/functions/v1/flow-mcp
```
Opening it in a browser shows a small JSON health message.

### 4. Add it to Claude
In Claude, add a **custom connector** with the URL above (on Team/Enterprise plans an owner adds it once for the whole organization; each person then clicks **Connect**).

The first time someone connects:
1. Claude opens the Flow login page → they sign in with their normal Flow email and password.
2. They see "Allow Claude to use Flow as you?" → **Allow**.
3. Done. Claude refreshes the token by itself after that.

---

## Day-to-day notes

- **Same permissions as the app.** Visibility follows the web app (CS Managers see their own tickets; Product sees Pending Review onwards; CS Lead/Admin see all). Stage rules are the same: never back to New Escalation, "Resolved by CS Lead" only from New Escalation, Closed only by the ticket creator once resolved (Admin can always close).
- **Claude should confirm before changing anything.** The server tells Claude to confirm creates/updates with the person first.
- **Things that still happen only in the web app:** moving expired holds back to Pending Review, updating SLA breach counts, and syncing Jira status all run when someone opens Flow in the browser. `needs_attention` shows expired holds so nothing is missed.
- **Analytics dates** (this week / month / year) use India time, like the app does in the browser.
- **Removing access:** disconnect the connector in Claude. Removing someone from Flow (or changing their role) takes effect on their next request, because every call re-reads their profile.

## When you change Flow's rules

If you change who can do what in `src/lib/stateMachine.ts`, `src/types/index.ts`, `src/hooks/useTickets.tsx` (visibility / SLA) or `src/lib/jiraUtils.ts`, make the same change in `supabase/functions/_shared/flowRules.ts`, then run:

```bash
npm run check:mcp-rules     # needs Deno installed
```

It compares both copies across every role × stage combination and fails if they disagree. Redeploy the function afterwards.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Claude says it can't connect / no sign-in window | Function deployed without `--no-verify-jwt`, or OAuth server / dynamic client registration not enabled. |
| Login works but lands on a blank or wrong page | Site URL in Supabase isn't the Vercel URL, or Authorization Path isn't `/oauth/consent`. |
| "This login has no Flow profile" | The account was never invited through User Management. |
| "The database refused to …" | The role isn't allowed to make that change (RLS). Working as intended. |
| Function logs | Supabase dashboard → Edge Functions → `flow-mcp` → Logs. |
