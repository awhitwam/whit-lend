-- =====================================================
-- Bank Reconciliation Tables
-- =====================================================
-- Supports importing bank statements and reconciling them
-- against loans, investors, and expenses.

-- Bank statement entries (imported from CSV)
CREATE TABLE IF NOT EXISTS public.bank_statements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  bank_source text NOT NULL,  -- 'allica', 'barclays', 'openbanking'
  statement_date date NOT NULL,
  transaction_type text,      -- CRDT/DBIT or bank category
  description text,
  amount numeric NOT NULL,
  balance numeric,
  raw_data jsonb,             -- Store original CSV row for reference
  external_reference text,    -- Unique identifier to prevent duplicates
  is_reconciled boolean DEFAULT false,
  reconciled_at timestamp with time zone,
  reconciled_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bank_statements_pkey PRIMARY KEY (id)
);

-- Reconciliation links (what each bank entry was matched to)
-- Supports split transactions (one bank entry -> multiple system entries)
CREATE TABLE IF NOT EXISTS public.reconciliation_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  bank_statement_id uuid NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,

  -- Link to one of these (mutually exclusive)
  loan_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  investor_transaction_id uuid REFERENCES public."InvestorTransaction"(id) ON DELETE SET NULL,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,

  -- For split transactions
  amount numeric NOT NULL,    -- Portion of bank entry this covers
  reconciliation_type text NOT NULL,  -- loan_repayment, loan_disbursement, investor_credit, investor_withdrawal, investor_interest, expense

  notes text,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT reconciliation_entries_pkey PRIMARY KEY (id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bank_statements_org ON public.bank_statements(organization_id);
CREATE INDEX IF NOT EXISTS idx_bank_statements_date ON public.bank_statements(statement_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_statements_reconciled ON public.bank_statements(is_reconciled);
CREATE INDEX IF NOT EXISTS idx_bank_statements_external_ref ON public.bank_statements(organization_id, external_reference);
CREATE INDEX IF NOT EXISTS idx_reconciliation_entries_bank ON public.reconciliation_entries(bank_statement_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_entries_org ON public.reconciliation_entries(organization_id);

-- Enable RLS
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bank_statements
DROP POLICY IF EXISTS "bank_statements_select" ON bank_statements;
CREATE POLICY "bank_statements_select" ON bank_statements
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "bank_statements_insert" ON bank_statements;
CREATE POLICY "bank_statements_insert" ON bank_statements
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "bank_statements_update" ON bank_statements;
CREATE POLICY "bank_statements_update" ON bank_statements
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "bank_statements_delete" ON bank_statements;
CREATE POLICY "bank_statements_delete" ON bank_statements
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- RLS Policies for reconciliation_entries
DROP POLICY IF EXISTS "reconciliation_entries_select" ON reconciliation_entries;
CREATE POLICY "reconciliation_entries_select" ON reconciliation_entries
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "reconciliation_entries_insert" ON reconciliation_entries;
CREATE POLICY "reconciliation_entries_insert" ON reconciliation_entries
  FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "reconciliation_entries_update" ON reconciliation_entries;
CREATE POLICY "reconciliation_entries_update" ON reconciliation_entries
  FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS "reconciliation_entries_delete" ON reconciliation_entries;
CREATE POLICY "reconciliation_entries_delete" ON reconciliation_entries
  FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Comments
COMMENT ON TABLE public.bank_statements IS 'Imported bank statement entries for reconciliation';
COMMENT ON TABLE public.reconciliation_entries IS 'Links bank statements to system transactions/expenses';
COMMENT ON COLUMN public.bank_statements.external_reference IS 'Unique reference from bank to prevent duplicate imports';
COMMENT ON COLUMN public.reconciliation_entries.reconciliation_type IS 'Type: loan_repayment, loan_disbursement, investor_credit, investor_withdrawal, investor_interest, expense';
