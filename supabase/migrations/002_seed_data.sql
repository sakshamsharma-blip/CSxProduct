-- =============================================
-- SEED DATA FOR TESTING
-- =============================================
-- NOTE: These users must first be created in Supabase Auth.
-- After creating them in Auth (Dashboard > Authentication > Users),
-- copy their UUIDs below and run this script.
--
-- Test accounts to create in Supabase Auth:
--   1. csm1@iett.local     (password: Test1234!) → CS_MANAGER
--   2. csm2@iett.local     (password: Test1234!) → CS_MANAGER
--   3. csm3@iett.local     (password: Test1234!) → CS_MANAGER
--   4. cslead@iett.local   (password: Test1234!) → CS_LEAD
--   5. prodlead@iett.local (password: Test1234!) → PRODUCT_LEAD
--
-- After creating the auth users, replace the UUIDs below with actual values
-- and run this in the SQL Editor.

-- INSERT INTO app_users (id, full_name, email, role) VALUES
--   ('REPLACE-UUID-1', 'CS Manager 1', 'csm1@iett.local', 'CS_MANAGER'),
--   ('REPLACE-UUID-2', 'CS Manager 2', 'csm2@iett.local', 'CS_MANAGER'),
--   ('REPLACE-UUID-3', 'CS Manager 3', 'csm3@iett.local', 'CS_MANAGER'),
--   ('REPLACE-UUID-4', 'CS Lead', 'cslead@iett.local', 'CS_LEAD'),
--   ('REPLACE-UUID-5', 'Product Lead', 'prodlead@iett.local', 'PRODUCT_LEAD');

-- =============================================
-- ALTERNATIVE: Auto-create via Supabase Auth Admin API
-- This function creates users and inserts them into app_users automatically.
-- Run this AFTER running the schema migration (001_schema.sql).
-- =============================================

-- We'll use a trigger to auto-insert into app_users when auth users sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.app_users (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'CS_MANAGER')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: auto-creates app_user profile on signup
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
