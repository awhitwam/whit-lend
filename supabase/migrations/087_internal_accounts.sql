-- Internal accounts and transfers
--
-- Money moved between the organisation's own accounts - savings pots, reserve
-- accounts, a second current account - appears in the bank feed as an ordinary debit
-- or credit, but it is not income, expenditure, lending or investor capital. Before
-- this there was nowhere to put such an entry: it either sat unreconciled forever or
-- was mis-filed as an expense, distorting the P&L.
--
-- internal_accounts  - the pots themselves
-- internal_transfers - the movements, which give each pot a running balance
--
-- Deliberately kept out of every existing reporting table. Nothing in the accountant
-- report, the income & expenditure report or the investor aggregates reads these, so
-- transfers are net-zero to the books by construction rather than by remembering to
-- exclude them in each place.

CREATE TABLE IF NOT EXISTS public.internal_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  -- Free text shown on the bank line for this pot, e.g. 'SAVINGS POT'. Used to
  -- suggest the account when reconciling; not required.
  match_keyword TEXT,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.internal_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  internal_account_id UUID NOT NULL REFERENCES public.internal_accounts(id) ON DELETE RESTRICT,

  date DATE NOT NULL,
  -- Always positive. `direction` carries the sign.
  amount NUMERIC NOT NULL CHECK (amount > 0),
  -- Relative to the INTERNAL account, not the current account:
  --   'in'  - money moved into the pot   (a debit on the bank statement)
  --   'out' - money came back from the pot (a credit on the bank statement)
  -- Balance = SUM(amount) FILTER (direction='in') - SUM(amount) FILTER (direction='out')
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),

  description TEXT,
  reference TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Link a reconciliation entry to the transfer it created, so unreconciling can undo it.
-- Mirrors the existing loan_transaction_id / investor_transaction_id / expense_id columns.
ALTER TABLE public.reconciliation_entries
ADD COLUMN IF NOT EXISTS internal_transfer_id UUID
  REFERENCES public.internal_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_internal_accounts_org
  ON public.internal_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_org
  ON public.internal_transfers(organization_id);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_account
  ON public.internal_transfers(internal_account_id, date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_entries_internal_transfer
  ON public.reconciliation_entries(internal_transfer_id)
  WHERE internal_transfer_id IS NOT NULL;

ALTER TABLE public.internal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_transfers ENABLE ROW LEVEL SECURITY;

-- RLS: same org-membership shape as every other table here (see 082_property_documents.sql)
CREATE POLICY "Users can view internal accounts in their organization"
ON public.internal_accounts FOR SELECT TO authenticated
USING (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can insert internal accounts in their organization"
ON public.internal_accounts FOR INSERT TO authenticated
WITH CHECK (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can update internal accounts in their organization"
ON public.internal_accounts FOR UPDATE TO authenticated
USING (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can delete internal accounts in their organization"
ON public.internal_accounts FOR DELETE TO authenticated
USING (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can view internal transfers in their organization"
ON public.internal_transfers FOR SELECT TO authenticated
USING (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can insert internal transfers in their organization"
ON public.internal_transfers FOR INSERT TO authenticated
WITH CHECK (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can update internal transfers in their organization"
ON public.internal_transfers FOR UPDATE TO authenticated
USING (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can delete internal transfers in their organization"
ON public.internal_transfers FOR DELETE TO authenticated
USING (organization_id IN (
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
));

CREATE OR REPLACE FUNCTION update_internal_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS internal_accounts_updated_at ON public.internal_accounts;
CREATE TRIGGER internal_accounts_updated_at
  BEFORE UPDATE ON public.internal_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_internal_accounts_updated_at();

COMMENT ON TABLE public.internal_accounts IS
  'Organisation-owned accounts (savings pots, reserves) that money is moved to and from. Not investors, not expenses.';
COMMENT ON COLUMN public.internal_transfers.direction IS
  'Relative to the internal account: in = money into the pot (bank debit), out = money back to the current account (bank credit).';
