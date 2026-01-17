-- ============================================
-- Migration 018: Add Missing RLS Policies
-- ============================================
--
-- This adds RLS policies for tables that were added after
-- the initial multi-tenancy migration:
-- - audit_logs
-- - properties
-- - loan_properties
-- - value_history
-- - first_charge_holders
--
-- Run this in Supabase SQL Editor
--

-- Step 1: Enable RLS on missing tables
-- ============================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE value_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE first_charge_holders ENABLE ROW LEVEL SECURITY;

-- Step 2: Audit Logs policies
-- Audit logs are read-only for users (system writes them)
-- ============================================

CREATE POLICY "View organization audit logs" ON audit_logs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Allow insert for authenticated users (for their own org)
CREATE POLICY "Create audit logs" ON audit_logs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Step 3: Properties policies
-- ============================================

CREATE POLICY "View organization properties" ON properties
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create properties" ON properties
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Managers update properties" ON properties
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Admins delete properties" ON properties
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role = 'Admin'
        AND is_active = true
    )
  );

-- Step 4: Loan Properties policies
-- ============================================

CREATE POLICY "View organization loan properties" ON loan_properties
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create loan properties" ON loan_properties
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Managers update loan properties" ON loan_properties
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Admins delete loan properties" ON loan_properties
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role = 'Admin'
        AND is_active = true
    )
  );

-- Step 5: Value History policies
-- ============================================

CREATE POLICY "View organization value history" ON value_history
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create value history" ON value_history
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Managers update value history" ON value_history
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Admins delete value history" ON value_history
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role = 'Admin'
        AND is_active = true
    )
  );

-- Step 6: First Charge Holders policies
-- ============================================

CREATE POLICY "View organization first charge holders" ON first_charge_holders
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create first charge holders" ON first_charge_holders
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Managers update first charge holders" ON first_charge_holders
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('Admin', 'Manager')
        AND is_active = true
    )
  );

CREATE POLICY "Admins delete first charge holders" ON first_charge_holders
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role = 'Admin'
        AND is_active = true
    )
  );

-- ============================================
-- RLS policies for missing tables complete!
-- ============================================
