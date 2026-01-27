-- =====================================================
-- Optimize RLS Policies for Better Performance
-- =====================================================
-- This migration fixes a performance issue where auth.uid() and other
-- auth functions are re-evaluated for each row in RLS policies.
-- Wrapping them in (SELECT ...) makes them evaluate once per query.
--
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- =====================================================
-- UPDATE user_org_ids() FUNCTION
-- =====================================================
-- This function is used by most RLS policies. Optimizing it helps all of them.
CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = (SELECT auth.uid()) AND is_active = true;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =====================================================
-- UPDATE is_organization_member() FUNCTION
-- =====================================================
-- Keep original parameter names to avoid needing to drop function
CREATE OR REPLACE FUNCTION is_organization_member(org_id UUID, user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = org_id
      AND om.user_id = is_organization_member.user_id
      AND om.is_active = true
  );
$$;

-- =====================================================
-- UPDATE is_org_admin() FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members
    WHERE organization_id = org_id
      AND user_id = (SELECT auth.uid())
      AND role = 'Admin'
      AND is_active = true
  );
$$;

-- =====================================================
-- FIX ORGANIZATION_MEMBERS POLICIES
-- =====================================================
-- These policies directly use auth.uid() and need fixing
DROP POLICY IF EXISTS "organization_members_select" ON organization_members;
DROP POLICY IF EXISTS "organization_members_insert" ON organization_members;
DROP POLICY IF EXISTS "organization_members_update" ON organization_members;
DROP POLICY IF EXISTS "organization_members_delete" ON organization_members;

CREATE POLICY "organization_members_select" ON organization_members
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR organization_id IN (SELECT user_org_ids())
  );

CREATE POLICY "organization_members_insert" ON organization_members
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT user_org_ids())
    AND is_org_admin(organization_id)
  );

CREATE POLICY "organization_members_update" ON organization_members
  FOR UPDATE USING (
    organization_id IN (SELECT user_org_ids())
    AND is_org_admin(organization_id)
  );

CREATE POLICY "organization_members_delete" ON organization_members
  FOR DELETE USING (
    organization_id IN (SELECT user_org_ids())
    AND is_org_admin(organization_id)
  );

-- =====================================================
-- FIX USER_PROFILES POLICIES
-- =====================================================
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_select" ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_update" ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_insert" ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_delete" ON user_profiles;

CREATE POLICY "user_profiles_select" ON user_profiles
  FOR SELECT USING (id = (SELECT auth.uid()));

CREATE POLICY "user_profiles_update" ON user_profiles
  FOR UPDATE USING (id = (SELECT auth.uid()));

-- =====================================================
-- FIX TRUSTED_DEVICES POLICIES
-- =====================================================
DROP POLICY IF EXISTS "Users can view own devices" ON trusted_devices;
DROP POLICY IF EXISTS "Users can insert own devices" ON trusted_devices;
DROP POLICY IF EXISTS "Users can update own devices" ON trusted_devices;
DROP POLICY IF EXISTS "Users can delete own devices" ON trusted_devices;
DROP POLICY IF EXISTS "trusted_devices_select" ON trusted_devices;
DROP POLICY IF EXISTS "trusted_devices_insert" ON trusted_devices;
DROP POLICY IF EXISTS "trusted_devices_update" ON trusted_devices;
DROP POLICY IF EXISTS "trusted_devices_delete" ON trusted_devices;

CREATE POLICY "trusted_devices_select" ON trusted_devices
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "trusted_devices_insert" ON trusted_devices
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "trusted_devices_update" ON trusted_devices
  FOR UPDATE USING (user_id = (SELECT auth.uid()));

CREATE POLICY "trusted_devices_delete" ON trusted_devices
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- =====================================================
-- FIX BORROWERS POLICIES (drop old-style names too)
-- =====================================================
DROP POLICY IF EXISTS "Admins delete borrowers" ON borrowers;
DROP POLICY IF EXISTS "borrowers_select" ON borrowers;
DROP POLICY IF EXISTS "borrowers_insert" ON borrowers;
DROP POLICY IF EXISTS "borrowers_update" ON borrowers;
DROP POLICY IF EXISTS "borrowers_delete" ON borrowers;

CREATE POLICY "borrowers_select" ON borrowers
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "borrowers_insert" ON borrowers
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "borrowers_update" ON borrowers
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "borrowers_delete" ON borrowers
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIX LOANS POLICIES
-- =====================================================
DROP POLICY IF EXISTS "Admins delete loans" ON loans;
DROP POLICY IF EXISTS "loans_select" ON loans;
DROP POLICY IF EXISTS "loans_insert" ON loans;
DROP POLICY IF EXISTS "loans_update" ON loans;
DROP POLICY IF EXISTS "loans_delete" ON loans;

CREATE POLICY "loans_select" ON loans
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loans_insert" ON loans
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loans_update" ON loans
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loans_delete" ON loans
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIX LOAN_PRODUCTS POLICIES
-- =====================================================
DROP POLICY IF EXISTS "Admins delete loan products" ON loan_products;
DROP POLICY IF EXISTS "loan_products_select" ON loan_products;
DROP POLICY IF EXISTS "loan_products_insert" ON loan_products;
DROP POLICY IF EXISTS "loan_products_update" ON loan_products;
DROP POLICY IF EXISTS "loan_products_delete" ON loan_products;

CREATE POLICY "loan_products_select" ON loan_products
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loan_products_insert" ON loan_products
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loan_products_update" ON loan_products
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loan_products_delete" ON loan_products
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIX TRANSACTIONS POLICIES
-- =====================================================
DROP POLICY IF EXISTS "transactions_select" ON transactions;
DROP POLICY IF EXISTS "transactions_insert" ON transactions;
DROP POLICY IF EXISTS "transactions_update" ON transactions;
DROP POLICY IF EXISTS "transactions_delete" ON transactions;

CREATE POLICY "transactions_select" ON transactions
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "transactions_insert" ON transactions
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "transactions_update" ON transactions
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "transactions_delete" ON transactions
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIX REPAYMENT_SCHEDULES POLICIES
-- =====================================================
DROP POLICY IF EXISTS "repayment_schedules_select" ON repayment_schedules;
DROP POLICY IF EXISTS "repayment_schedules_insert" ON repayment_schedules;
DROP POLICY IF EXISTS "repayment_schedules_update" ON repayment_schedules;
DROP POLICY IF EXISTS "repayment_schedules_delete" ON repayment_schedules;

CREATE POLICY "repayment_schedules_select" ON repayment_schedules
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "repayment_schedules_insert" ON repayment_schedules
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "repayment_schedules_update" ON repayment_schedules
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "repayment_schedules_delete" ON repayment_schedules
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIX EXPENSES POLICIES
-- =====================================================
DROP POLICY IF EXISTS "expenses_select" ON expenses;
DROP POLICY IF EXISTS "expenses_insert" ON expenses;
DROP POLICY IF EXISTS "expenses_update" ON expenses;
DROP POLICY IF EXISTS "expenses_delete" ON expenses;

CREATE POLICY "expenses_select" ON expenses
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "expenses_insert" ON expenses
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "expenses_update" ON expenses
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "expenses_delete" ON expenses
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIX AUDIT_LOGS POLICIES
-- =====================================================
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;

-- Allow inserts for authenticated users (audit logging)
CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
  );

-- Users can view audit logs for their organizations
CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (
    organization_id IN (SELECT user_org_ids())
    OR organization_id IS NULL
  );

COMMENT ON FUNCTION user_org_ids() IS 'Returns organization IDs for the current user. Optimized with (SELECT auth.uid()) for better RLS performance.';
