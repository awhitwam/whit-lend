-- =====================================================
-- RLS Policies for Organization Data Isolation
-- Run this in Supabase SQL Editor
-- =====================================================

-- Helper function to get user's organization IDs
-- Uses SECURITY DEFINER to avoid recursion when querying organization_members
CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid() AND is_active = true;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =====================================================
-- BORROWERS
-- =====================================================
ALTER TABLE borrowers ENABLE ROW LEVEL SECURITY;

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
-- LOANS
-- =====================================================
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

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
-- LOAN_PRODUCTS
-- =====================================================
ALTER TABLE loan_products ENABLE ROW LEVEL SECURITY;

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
-- TRANSACTIONS
-- =====================================================
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

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
-- REPAYMENT_SCHEDULES
-- =====================================================
ALTER TABLE repayment_schedules ENABLE ROW LEVEL SECURITY;

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
-- EXPENSES
-- =====================================================
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

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
-- EXPENSE_TYPES
-- =====================================================
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_types_select" ON expense_types;
DROP POLICY IF EXISTS "expense_types_insert" ON expense_types;
DROP POLICY IF EXISTS "expense_types_update" ON expense_types;
DROP POLICY IF EXISTS "expense_types_delete" ON expense_types;

CREATE POLICY "expense_types_select" ON expense_types
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "expense_types_insert" ON expense_types
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "expense_types_update" ON expense_types
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "expense_types_delete" ON expense_types
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- INVESTOR (PascalCase table name)
-- =====================================================
ALTER TABLE "Investor" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investor_select" ON "Investor";
DROP POLICY IF EXISTS "investor_insert" ON "Investor";
DROP POLICY IF EXISTS "investor_update" ON "Investor";
DROP POLICY IF EXISTS "investor_delete" ON "Investor";

CREATE POLICY "investor_select" ON "Investor"
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investor_insert" ON "Investor"
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investor_update" ON "Investor"
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investor_delete" ON "Investor"
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- INVESTORTRANSACTION (PascalCase table name)
-- =====================================================
ALTER TABLE "InvestorTransaction" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investortx_select" ON "InvestorTransaction";
DROP POLICY IF EXISTS "investortx_insert" ON "InvestorTransaction";
DROP POLICY IF EXISTS "investortx_update" ON "InvestorTransaction";
DROP POLICY IF EXISTS "investortx_delete" ON "InvestorTransaction";

CREATE POLICY "investortx_select" ON "InvestorTransaction"
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investortx_insert" ON "InvestorTransaction"
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investortx_update" ON "InvestorTransaction"
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "investortx_delete" ON "InvestorTransaction"
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- AUDIT_LOGS
-- =====================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_update" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete" ON audit_logs;

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "audit_logs_update" ON audit_logs
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "audit_logs_delete" ON audit_logs
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- PROPERTIES
-- =====================================================
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_select" ON properties;
DROP POLICY IF EXISTS "properties_insert" ON properties;
DROP POLICY IF EXISTS "properties_update" ON properties;
DROP POLICY IF EXISTS "properties_delete" ON properties;

CREATE POLICY "properties_select" ON properties
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "properties_insert" ON properties
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "properties_update" ON properties
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "properties_delete" ON properties
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- LOAN_PROPERTIES
-- =====================================================
ALTER TABLE loan_properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_properties_select" ON loan_properties;
DROP POLICY IF EXISTS "loan_properties_insert" ON loan_properties;
DROP POLICY IF EXISTS "loan_properties_update" ON loan_properties;
DROP POLICY IF EXISTS "loan_properties_delete" ON loan_properties;

CREATE POLICY "loan_properties_select" ON loan_properties
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loan_properties_insert" ON loan_properties
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loan_properties_update" ON loan_properties
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "loan_properties_delete" ON loan_properties
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- VALUE_HISTORY
-- =====================================================
ALTER TABLE value_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "value_history_select" ON value_history;
DROP POLICY IF EXISTS "value_history_insert" ON value_history;
DROP POLICY IF EXISTS "value_history_update" ON value_history;
DROP POLICY IF EXISTS "value_history_delete" ON value_history;

CREATE POLICY "value_history_select" ON value_history
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "value_history_insert" ON value_history
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "value_history_update" ON value_history
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "value_history_delete" ON value_history
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- FIRST_CHARGE_HOLDERS
-- =====================================================
ALTER TABLE first_charge_holders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "first_charge_holders_select" ON first_charge_holders;
DROP POLICY IF EXISTS "first_charge_holders_insert" ON first_charge_holders;
DROP POLICY IF EXISTS "first_charge_holders_update" ON first_charge_holders;
DROP POLICY IF EXISTS "first_charge_holders_delete" ON first_charge_holders;

CREATE POLICY "first_charge_holders_select" ON first_charge_holders
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "first_charge_holders_insert" ON first_charge_holders
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "first_charge_holders_update" ON first_charge_holders
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "first_charge_holders_delete" ON first_charge_holders
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- INVITATIONS (also org-scoped per dataClient.js)
-- =====================================================
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_select" ON invitations;
DROP POLICY IF EXISTS "invitations_insert" ON invitations;
DROP POLICY IF EXISTS "invitations_update" ON invitations;
DROP POLICY IF EXISTS "invitations_delete" ON invitations;

CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "invitations_update" ON invitations
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));
CREATE POLICY "invitations_delete" ON invitations
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));
