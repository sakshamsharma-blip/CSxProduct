-- Pin search_path on the two trigger functions added in 007
-- (Supabase security advisor: "Function Search Path Mutable").
-- Both only touch NEW/OLD and built-in functions, so an empty path is safe.
ALTER FUNCTION public.tickets_sync_jira_key() SET search_path = '';
ALTER FUNCTION public.tickets_set_updated_at() SET search_path = '';
