-- =============================================
-- NUKE QUERY - Run this FIRST in Supabase SQL Editor
-- This drops ALL existing IETT tables, enums, triggers, and sequences
-- Then run 001_full_schema.sql to recreate everything fresh
-- =============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS set_updated_at ON tickets;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Drop tables (order matters due to foreign keys)
DROP TABLE IF EXISTS update_logs CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS app_users CASCADE;

-- Drop sequence
DROP SEQUENCE IF EXISTS ticket_id_seq;

-- Drop enums
DROP TYPE IF EXISTS sprint_status;
DROP TYPE IF EXISTS ticket_priority;
DROP TYPE IF EXISTS ticket_sub_type;
DROP TYPE IF EXISTS ticket_status;
DROP TYPE IF EXISTS user_role;

-- =============================================
-- ALSO: Delete all auth users
-- Go to Authentication > Users in Supabase Dashboard
-- Select all users and delete them
-- Then re-signup fresh after running 001_full_schema.sql
-- =============================================
