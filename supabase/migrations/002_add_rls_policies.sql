-- ============================================
-- Multi-Tenancy Migration Script
-- Part 2: Row Level Security (RLS) Policies
-- ============================================
--
-- This script enables RLS and creates policies for data isolation
-- Run this AFTER 001_add_multi_tenancy.sql
--
-- IMPORTANT: Test in development first!
--

-- Step 1: Enable RLS on all tables
-- ============================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE repayment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Investor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvestorTransaction" ENABLE ROW LEVEL SECURITY;

-- Step 2: Organizations policies
-- ============================================

CREATE POLICY "Users can view their organizations" ON organizations
  FOR SELECT
  USING (
    id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Admins can update their organization" ON organizations
  FOR UPDATE
  USING (
    id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

CREATE POLICY "Admins can create organizations" ON organizations
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Step 3: Organization members policies
-- ============================================

CREATE POLICY "View organization members" ON organization_members
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Admins manage members" ON organization_members
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

-- Step 4: Invitations policies
-- ============================================

CREATE POLICY "View organization invitations" ON invitations
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "Admins create invitations" ON invitations
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

CREATE POLICY "Admins update invitations" ON invitations
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND role = 'Admin' AND is_active = true
    )
  );

-- Step 5: User profiles policies
-- ============================================

CREATE POLICY "Users view own profile" ON user_profiles
  FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users update own profile" ON user_profiles
  FOR ALL
  USING (id = auth.uid());

-- Step 6: Borrowers policies
-- ============================================

CREATE POLICY "View organization borrowers" ON borrowers
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create borrowers" ON borrowers
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

CREATE POLICY "Managers update borrowers" ON borrowers
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

CREATE POLICY "Admins delete borrowers" ON borrowers
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

-- Step 7: Loans policies
-- ============================================

CREATE POLICY "View organization loans" ON loans
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create loans" ON loans
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

CREATE POLICY "Managers update loans" ON loans
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

CREATE POLICY "Admins delete loans" ON loans
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

-- Step 8: Loan products policies
-- ============================================

CREATE POLICY "View organization loan products" ON loan_products
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create loan products" ON loan_products
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

CREATE POLICY "Managers update loan products" ON loan_products
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

CREATE POLICY "Admins delete loan products" ON loan_products
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

-- Step 9: Transactions policies
-- ============================================

CREATE POLICY "View organization transactions" ON transactions
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create transactions" ON transactions
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

CREATE POLICY "Managers update transactions" ON transactions
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

CREATE POLICY "Admins delete transactions" ON transactions
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

-- Step 10: Repayment schedules policies
-- ============================================

CREATE POLICY "View organization repayment schedules" ON repayment_schedules
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create repayment schedules" ON repayment_schedules
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

CREATE POLICY "Managers update repayment schedules" ON repayment_schedules
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

CREATE POLICY "Admins delete repayment schedules" ON repayment_schedules
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

-- Step 11: Expenses policies
-- ============================================

CREATE POLICY "View organization expenses" ON expenses
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create expenses" ON expenses
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

CREATE POLICY "Managers update expenses" ON expenses
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

CREATE POLICY "Admins delete expenses" ON expenses
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

-- Step 12: Expense types policies
-- ============================================

CREATE POLICY "View organization expense types" ON expense_types
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create expense types" ON expense_types
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

CREATE POLICY "Managers update expense types" ON expense_types
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

CREATE POLICY "Admins delete expense types" ON expense_types
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

-- Step 13: Investor policies
-- ============================================

CREATE POLICY "View organization investors" ON "Investor"
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create investors" ON "Investor"
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

CREATE POLICY "Managers update investors" ON "Investor"
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

CREATE POLICY "Admins delete investors" ON "Investor"
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

-- Step 14: Investor transaction policies
-- ============================================

CREATE POLICY "View organization investor transactions" ON "InvestorTransaction"
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Managers create investor transactions" ON "InvestorTransaction"
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

CREATE POLICY "Managers update investor transactions" ON "InvestorTransaction"
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

CREATE POLICY "Admins delete investor transactions" ON "InvestorTransaction"
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

-- RLS policies complete!
-- Test by logging in as a user and querying the tables
