// Supabase Edge Function: flow-mcp — remote MCP server for Flow.
// See server.ts for how it works and docs/MCP.md for setup.
import { handler } from './server.ts';

Deno.serve(handler);
