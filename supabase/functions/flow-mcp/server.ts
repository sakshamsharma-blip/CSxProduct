// Flow MCP server — request handling (entrypoint is index.ts)
// ---------------------------------------------------------------
// Remote MCP server for Flow (CS ↔ Product escalation tracker), so Claude
// can read and update tickets on behalf of the signed-in person.
//
// Auth: Supabase Auth's OAuth 2.1 server is the authorization server.
//   - Claude discovers it via /.well-known/oauth-protected-resource below,
//     registers itself (dynamic client registration), and sends the user to
//     the Flow web app's /oauth/consent page to sign in and approve.
//   - Every MCP request then carries that user's Supabase access token, and
//     all queries run with it — the same RLS + role rules as the web app.
//
// Deploy (must skip the gateway JWT check so discovery + 401s reach us):
//   supabase functions deploy flow-mcp --no-verify-jwt
//
// Connector URL to give Claude:
//   https://<project-ref>.supabase.co/functions/v1/flow-mcp
//
// Optional secrets:
//   FLOW_MCP_PUBLIC_URL  override the public URL above (custom domain etc.)
//   FLOW_MCP_AUDIT_TAG   text appended to timeline entries written via Claude
//                        (default "(via Claude)", set "" to disable)
// ---------------------------------------------------------------

import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.32.1/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.32.1/server/webStandardStreamableHttp.js';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { UserRole } from '../_shared/flowRules.ts';
import { registerTools } from './tools.ts';
import type { Ctx, Me } from './data.ts';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const PUBLIC_URL = (Deno.env.get('FLOW_MCP_PUBLIC_URL') ?? `${SUPABASE_URL}/functions/v1/flow-mcp`).replace(/\/$/, '');
const AUTH_ISSUER = `${SUPABASE_URL}/auth/v1`;
const RESOURCE_METADATA_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource`;

const SERVER_INFO = { name: 'creliohealth-flow', version: '1.0.0' };
const INSTRUCTIONS =
  'Flow is CrelioHealth\'s internal escalation tracker between Customer Success (CS) and Product. ' +
  'Tickets have IDs like REQ-1042 and move through stages: New Escalation → (Resolved by CS Lead | Pending Product Review) → ' +
  'In Product Scope → In Progress → (On Hold | Returned to CS Lead) → Resolved → Closed. ' +
  'In Scope / In Progress tickets need a weekly product update (or Jira status change) at least every 7 days. ' +
  'All actions run as the signed-in user with their Flow role; call whoami if unsure what they may do, and get_ticket ' +
  'to see the allowed actions on a ticket. Always confirm with the user before creating or changing a ticket.';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id, x-client-info, apikey',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, mcp-session-id, mcp-protocol-version',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

function unauthorized(reason?: string): Response {
  const params = [`resource_metadata="${RESOURCE_METADATA_URL}"`];
  // Header values must be plain ASCII.
  if (reason) params.push('error="invalid_token"', `error_description="${reason.replace(/[^\x20-\x7e]/g, '-').replace(/"/g, "'")}"`);
  return json(
    { jsonrpc: '2.0', error: { code: -32001, message: reason ?? 'Sign-in required' }, id: null },
    401,
    { 'WWW-Authenticate': `Bearer ${params.join(', ')}` },
  );
}

/** RFC 9728 protected-resource metadata: tells Claude where to sign in. */
function protectedResourceMetadata(): Response {
  return json({
    resource: PUBLIC_URL,
    authorization_servers: [AUTH_ISSUER],
    bearer_methods_supported: ['header'],
    // No scopes advertised on purpose: asking for "openid" makes Supabase mint
    // an ID token, which fails on projects still using the legacy HS256 JWT secret.
    resource_name: 'CrelioHealth Flow',
    resource_documentation: 'https://github.com/sakshamsharma-blip/CSxProduct/blob/main/docs/MCP.md',
  }, 200, { 'Cache-Control': 'public, max-age=300' });
}

/** Validates the bearer token and resolves the caller's Flow profile. */
async function authenticate(req: Request): Promise<Ctx | Response> {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized();
  const token = match[1].trim();

  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return unauthorized('Session expired or invalid — please reconnect Flow');
  const authId = userData.user.id;

  // Same identity resolution as the web app (useAuth.tsx): a secondary-domain
  // login is linked to its primary profile via primary_user_id.
  const { data: profile, error: profileError } = await db
    .from('app_users').select('id, full_name, email, role, primary_user_id').eq('id', authId).maybeSingle();
  if (profileError) {
    console.error('[flow-mcp] profile lookup failed', profileError);
    return json({ jsonrpc: '2.0', error: { code: -32603, message: 'Could not load your Flow profile' }, id: null }, 500);
  }
  if (!profile) {
    return json({ jsonrpc: '2.0', error: { code: -32003, message: 'This login has no Flow profile. Ask a CS Lead / Product Lead to invite you.' }, id: null }, 403);
  }
  let person = profile;
  if (profile.primary_user_id) {
    const { data: primary } = await db
      .from('app_users').select('id, full_name, email, role, primary_user_id').eq('id', profile.primary_user_id).maybeSingle();
    if (primary) person = primary;
  }

  const me: Me = {
    id: person.id,
    authId,
    full_name: person.full_name,
    email: person.email,
    role: person.role as UserRole,
  };
  return { db, me };
}

export async function handler(req: Request): Promise<Response> {
  try {
    return await route(req);
  } catch (err) {
    console.error('[flow-mcp] unhandled error', err);
    return json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }, 500);
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Hosted functions see "/flow-mcp/..." ; strip everything up to the function name.
  const path = url.pathname.replace(/^.*?\/flow-mcp/, '') || '/';

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (path.startsWith('/.well-known/oauth-protected-resource')) {
    return protectedResourceMetadata();
  }
  // Some clients look for the authorization-server metadata on the resource
  // itself; point them at Supabase Auth's real document.
  if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) {
    return Response.redirect(`${SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`, 302);
  }
  if (path !== '/' && path !== '/mcp') {
    return json({ error: 'Not found' }, 404);
  }
  if (req.method === 'GET' && !req.headers.get('Authorization')) {
    // Plain browser visit / health check.
    if (!(req.headers.get('accept') ?? '').includes('text/event-stream')) {
      return json({ name: SERVER_INFO.name, mcp_endpoint: PUBLIC_URL, auth: RESOURCE_METADATA_URL });
    }
  }

  const ctx = await authenticate(req);
  if (ctx instanceof Response) return ctx;

  // Stateless: a fresh server + transport per request (Edge Functions don't
  // keep memory between requests). JSON responses, no SSE stream.
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerTools(server, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    console.error('[flow-mcp] transport error', err);
    return json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }, 500);
  }
}
