-- Letter Templates System
-- Allows organizations to create and manage templated letters with placeholder substitution

-- Letter templates table
CREATE TABLE IF NOT EXISTS letter_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'General',
  subject_template TEXT,
  body_template TEXT NOT NULL,
  available_placeholders JSONB DEFAULT '[]'::jsonb,
  default_attachments TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Generated letters table (audit trail of letters created)
CREATE TABLE IF NOT EXISTS generated_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  template_id UUID REFERENCES letter_templates(id) ON DELETE SET NULL,
  loan_id UUID REFERENCES loans(id) ON DELETE SET NULL,
  borrower_id UUID REFERENCES borrowers(id) ON DELETE SET NULL,
  subject TEXT,
  body_rendered TEXT,
  placeholder_values JSONB DEFAULT '{}'::jsonb,
  attached_reports JSONB DEFAULT '[]'::jsonb,
  settlement_date DATE,
  pdf_storage_path TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_letter_templates_org ON letter_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_letter_templates_active ON letter_templates(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_generated_letters_org ON generated_letters(organization_id);
CREATE INDEX IF NOT EXISTS idx_generated_letters_loan ON generated_letters(loan_id);
CREATE INDEX IF NOT EXISTS idx_generated_letters_borrower ON generated_letters(borrower_id);

-- RLS policies for letter_templates
ALTER TABLE letter_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view templates in their organization"
  ON letter_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create templates in their organization"
  ON letter_templates FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update templates in their organization"
  ON letter_templates FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete templates in their organization"
  ON letter_templates FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- RLS policies for generated_letters
ALTER TABLE generated_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view letters in their organization"
  ON generated_letters FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can create letters in their organization"
  ON generated_letters FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Trigger to update updated_at on letter_templates
CREATE OR REPLACE FUNCTION update_letter_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER letter_templates_updated_at
  BEFORE UPDATE ON letter_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_letter_template_timestamp();

-- Insert some default templates
INSERT INTO letter_templates (organization_id, name, description, category, subject_template, body_template, available_placeholders, default_attachments)
SELECT
  o.id,
  'Settlement Quote',
  'Standard letter providing settlement figures for a loan',
  'Settlement',
  'Settlement Quote - {{loan_reference}}',
  'Dear {{borrower_name}},

Re: Loan Reference {{loan_reference}}
Property: {{property_address}}

Further to your request, please find below the settlement figures for the above loan as at {{settlement_date}}:

Principal Outstanding: {{settlement_principal}}
Interest Accrued: {{settlement_interest}}
Fees Outstanding: {{settlement_fees}}

Total Settlement Amount: {{settlement_total}}

Please note that these figures are valid for settlement on {{settlement_date}} only. If settlement occurs on a different date, revised figures will need to be obtained.

Please ensure that cleared funds are received by 3pm on the settlement date. Bank details for payment are as follows:

{{company_name}}
Sort Code: [SORT CODE]
Account Number: [ACCOUNT NUMBER]
Reference: {{loan_reference}}

Should you have any questions, please do not hesitate to contact us.

Yours sincerely,

{{company_name}}',
  '[
    {"key": "borrower_name", "description": "Primary borrower name"},
    {"key": "loan_reference", "description": "Loan reference number"},
    {"key": "property_address", "description": "Primary security address"},
    {"key": "settlement_date", "description": "Settlement date"},
    {"key": "settlement_principal", "description": "Principal portion of settlement"},
    {"key": "settlement_interest", "description": "Interest portion of settlement"},
    {"key": "settlement_fees", "description": "Fees included in settlement"},
    {"key": "settlement_total", "description": "Total settlement amount"},
    {"key": "company_name", "description": "Your company name"}
  ]'::jsonb,
  ARRAY['settlement_statement']
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM letter_templates lt WHERE lt.organization_id = o.id AND lt.name = 'Settlement Quote'
);

INSERT INTO letter_templates (organization_id, name, description, category, subject_template, body_template, available_placeholders, default_attachments)
SELECT
  o.id,
  'Loan Statement Cover Letter',
  'Cover letter to accompany a loan statement',
  'Statements',
  'Loan Statement - {{loan_reference}}',
  'Dear {{borrower_name}},

Re: Loan Reference {{loan_reference}}
Property: {{property_address}}

Please find enclosed your loan statement as at {{today_date}}.

Current Position:
Principal Balance: {{current_balance}}
Interest Rate: {{interest_rate}}% per annum
Maturity Date: {{maturity_date}}

If you have any questions regarding this statement, please do not hesitate to contact us.

Yours sincerely,

{{company_name}}',
  '[
    {"key": "borrower_name", "description": "Primary borrower name"},
    {"key": "loan_reference", "description": "Loan reference number"},
    {"key": "property_address", "description": "Primary security address"},
    {"key": "today_date", "description": "Current date"},
    {"key": "current_balance", "description": "Current outstanding balance"},
    {"key": "interest_rate", "description": "Current interest rate"},
    {"key": "maturity_date", "description": "Loan maturity date"},
    {"key": "company_name", "description": "Your company name"}
  ]'::jsonb,
  ARRAY['loan_statement']
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM letter_templates lt WHERE lt.organization_id = o.id AND lt.name = 'Loan Statement Cover Letter'
);

INSERT INTO letter_templates (organization_id, name, description, category, subject_template, body_template, available_placeholders, default_attachments)
SELECT
  o.id,
  'General Correspondence',
  'Blank letter template for custom correspondence',
  'General',
  '{{loan_reference}} - ',
  'Dear {{borrower_name}},

Re: Loan Reference {{loan_reference}}
Property: {{property_address}}

[Your message here]

Yours sincerely,

{{company_name}}',
  '[
    {"key": "borrower_name", "description": "Primary borrower name"},
    {"key": "loan_reference", "description": "Loan reference number"},
    {"key": "property_address", "description": "Primary security address"},
    {"key": "today_date", "description": "Current date"},
    {"key": "company_name", "description": "Your company name"}
  ]'::jsonb,
  ARRAY[]::TEXT[]
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM letter_templates lt WHERE lt.organization_id = o.id AND lt.name = 'General Correspondence'
);
