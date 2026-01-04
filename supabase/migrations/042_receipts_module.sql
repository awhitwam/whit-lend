-- =====================================================
-- Receipts Module Schema
-- =====================================================
-- Supports spreadsheet-style receipt entry with draft
-- persistence and borrower loan preferences.

-- =====================================================
-- Table 1: receipt_drafts
-- =====================================================
-- Persistent draft receipts before filing

CREATE TABLE IF NOT EXISTS public.receipt_drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  -- Entry source
  entry_mode text NOT NULL CHECK (entry_mode IN ('manual', 'bank_entry')),
  bank_statement_id uuid REFERENCES public.bank_statements(id) ON DELETE SET NULL,

  -- Receipt header
  receipt_date date NOT NULL,
  receipt_amount numeric NOT NULL,
  reference text,

  -- Borrower/loan selection
  borrower_id uuid REFERENCES public.borrowers(id),

  -- Allocations stored as JSONB: {loan_id: {principal, interest, fees}}
  allocations jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Selected loan IDs (array for ordering)
  selected_loan_ids uuid[] NOT NULL DEFAULT '{}',

  -- Status
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'cancelled')),
  filed_at timestamp with time zone,
  filed_by uuid,

  -- Ordering for spreadsheet display
  row_order integer,

  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT receipt_drafts_pkey PRIMARY KEY (id)
);

-- Indexes for receipt_drafts
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_org ON public.receipt_drafts(organization_id);
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_status ON public.receipt_drafts(status);
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_borrower ON public.receipt_drafts(borrower_id);
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_bank ON public.receipt_drafts(bank_statement_id);
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_row_order ON public.receipt_drafts(organization_id, status, row_order);

-- Enable RLS
ALTER TABLE public.receipt_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for receipt_drafts
DROP POLICY IF EXISTS "receipt_drafts_select" ON receipt_drafts;
CREATE POLICY "receipt_drafts_select" ON receipt_drafts
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "receipt_drafts_insert" ON receipt_drafts;
CREATE POLICY "receipt_drafts_insert" ON receipt_drafts
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "receipt_drafts_update" ON receipt_drafts;
CREATE POLICY "receipt_drafts_update" ON receipt_drafts
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "receipt_drafts_delete" ON receipt_drafts;
CREATE POLICY "receipt_drafts_delete" ON receipt_drafts
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- =====================================================
-- Table 2: borrower_loan_preferences
-- =====================================================
-- Remember default loan selections per borrower

CREATE TABLE IF NOT EXISTS public.borrower_loan_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  borrower_id uuid NOT NULL REFERENCES public.borrowers(id) ON DELETE CASCADE,

  -- Default loans to select (ordered list of loan IDs)
  default_loan_ids uuid[] NOT NULL DEFAULT '{}',

  -- Last allocation pattern: {loan_id: {principal_pct, interest_pct, fees_pct}}
  last_allocation_pattern jsonb,

  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT borrower_loan_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT borrower_loan_preferences_unique UNIQUE (organization_id, borrower_id)
);

-- Indexes for borrower_loan_preferences
CREATE INDEX IF NOT EXISTS idx_borrower_loan_prefs_org ON public.borrower_loan_preferences(organization_id);
CREATE INDEX IF NOT EXISTS idx_borrower_loan_prefs_borrower ON public.borrower_loan_preferences(borrower_id);

-- Enable RLS
ALTER TABLE public.borrower_loan_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for borrower_loan_preferences
DROP POLICY IF EXISTS "borrower_loan_prefs_select" ON borrower_loan_preferences;
CREATE POLICY "borrower_loan_prefs_select" ON borrower_loan_preferences
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "borrower_loan_prefs_insert" ON borrower_loan_preferences;
CREATE POLICY "borrower_loan_prefs_insert" ON borrower_loan_preferences
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "borrower_loan_prefs_update" ON borrower_loan_preferences;
CREATE POLICY "borrower_loan_prefs_update" ON borrower_loan_preferences
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "borrower_loan_prefs_delete" ON borrower_loan_preferences;
CREATE POLICY "borrower_loan_prefs_delete" ON borrower_loan_preferences
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Comments
COMMENT ON TABLE public.receipt_drafts IS 'Draft receipts for spreadsheet-style entry before filing';
COMMENT ON COLUMN public.receipt_drafts.entry_mode IS 'manual = typed entry, bank_entry = linked to bank statement';
COMMENT ON COLUMN public.receipt_drafts.allocations IS 'JSONB: {loan_id: {principal: x, interest: y, fees: z}}';
COMMENT ON COLUMN public.receipt_drafts.selected_loan_ids IS 'Ordered array of selected loan IDs';
COMMENT ON TABLE public.borrower_loan_preferences IS 'Stores default loan selections per borrower for receipts';
COMMENT ON COLUMN public.borrower_loan_preferences.default_loan_ids IS 'Default loans to pre-select when borrower is chosen';
COMMENT ON COLUMN public.borrower_loan_preferences.last_allocation_pattern IS 'Last used allocation percentages per loan';
