-- ============================================
-- Multi-Tenancy Migration Script
-- Part 1: Create Schema and Add organization_id
-- ============================================
--
-- This script adds multi-tenancy support to WhitLend
-- Run this in Supabase SQL Editor
--
-- IMPORTANT: Backup your database before running!
--

-- Step 1: Create new tables
-- ============================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Manager', 'Viewer')),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Manager', 'Viewer')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  default_organization_id UUID REFERENCES organizations(id),
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Create indexes for new tables
-- ============================================

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON organizations(created_by);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(role);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_default_org ON user_profiles(default_organization_id);

-- Step 3: Add organization_id to existing tables
-- ============================================

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE loan_products ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE repayment_schedules ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE expense_types ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE "InvestorTransaction" ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Step 4: Create first organization and backfill data
-- ============================================

DO $$
DECLARE
  first_org_id UUID;
  first_user_id UUID;
BEGIN
  -- Get the first user (or a specific user if you know their email)
  SELECT id INTO first_user_id FROM auth.users ORDER BY created_at LIMIT 1;

  -- Only proceed if we have a user
  IF first_user_id IS NOT NULL THEN
    -- Create the first organization
    INSERT INTO organizations (name, slug, created_by, created_at)
    VALUES ('Default Organization', 'default-organization', first_user_id, NOW())
    RETURNING id INTO first_org_id;

    RAISE NOTICE 'Created organization with ID: %', first_org_id;

    -- Make the first user an admin
    INSERT INTO organization_members (organization_id, user_id, role, joined_at)
    VALUES (first_org_id, first_user_id, 'Admin', NOW());

    RAISE NOTICE 'Added user % as Admin', first_user_id;

    -- Set as default org in user profile
    INSERT INTO user_profiles (id, default_organization_id)
    VALUES (first_user_id, first_org_id)
    ON CONFLICT (id) DO UPDATE SET default_organization_id = first_org_id;

    -- Backfill organization_id for all existing data
    UPDATE borrowers SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE loans SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE loan_products SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE transactions SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE repayment_schedules SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE expenses SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE expense_types SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE "Investor" SET organization_id = first_org_id WHERE organization_id IS NULL;
    UPDATE "InvestorTransaction" SET organization_id = first_org_id WHERE organization_id IS NULL;

    RAISE NOTICE 'Backfilled all existing data with organization_id';
  ELSE
    RAISE EXCEPTION 'No users found in the database. Cannot create first organization.';
  END IF;
END $$;

-- Step 5: Make organization_id NOT NULL after backfill
-- ============================================

ALTER TABLE borrowers ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE loans ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE loan_products ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE repayment_schedules ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE expense_types ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE "Investor" ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE "InvestorTransaction" ALTER COLUMN organization_id SET NOT NULL;

-- Step 6: Create indexes for organization_id on existing tables
-- ============================================

CREATE INDEX IF NOT EXISTS idx_borrowers_org ON borrowers(organization_id);
CREATE INDEX IF NOT EXISTS idx_loans_org ON loans(organization_id);
CREATE INDEX IF NOT EXISTS idx_loan_products_org ON loan_products(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_org ON transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_repayment_schedules_org ON repayment_schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_expense_types_org ON expense_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_investor_org ON "Investor"(organization_id);
CREATE INDEX IF NOT EXISTS idx_investor_transaction_org ON "InvestorTransaction"(organization_id);

-- Step 7: Verification queries (optional - uncomment to check)
-- ============================================

-- SELECT COUNT(*) as org_count FROM organizations;
-- SELECT COUNT(*) as member_count FROM organization_members;
-- SELECT COUNT(*) as borrowers_with_org FROM borrowers WHERE organization_id IS NOT NULL;
-- SELECT COUNT(*) as loans_with_org FROM loans WHERE organization_id IS NOT NULL;

-- Migration complete!
-- Next step: Run 002_add_rls_policies.sql
