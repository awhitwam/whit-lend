-- Migration: Create security/property tables for loan collateral tracking
-- Tables: properties, loan_properties, value_history, first_charge_holders

-- First charge holders (e.g., Halifax, Nationwide, etc.)
CREATE TABLE IF NOT EXISTS public.first_charge_holders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Properties (physical security assets)
CREATE TABLE IF NOT EXISTS public.properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    property_type TEXT DEFAULT 'Residential', -- Residential, Commercial, Land, etc.
    current_value NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Loan-Property junction table (many-to-many with charge details)
CREATE TABLE IF NOT EXISTS public.loan_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    loan_id UUID REFERENCES public.loans(id) ON DELETE CASCADE NOT NULL,
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
    charge_type TEXT DEFAULT 'First Charge', -- 'First Charge', 'Second Charge'
    first_charge_holder_id UUID REFERENCES public.first_charge_holders(id) ON DELETE SET NULL,
    first_charge_balance NUMERIC, -- Outstanding balance on first charge (for second charges)
    status TEXT DEFAULT 'Active', -- Active, Released, etc.
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(loan_id, property_id)
);

-- Value history for tracking property valuations and charge balances over time
CREATE TABLE IF NOT EXISTS public.value_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE NOT NULL,
    value_type TEXT NOT NULL, -- 'Property Valuation', 'First Charge Balance', 'Purchase Price', etc.
    value NUMERIC NOT NULL,
    effective_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_properties_organization ON public.properties(organization_id);
CREATE INDEX IF NOT EXISTS idx_loan_properties_loan ON public.loan_properties(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_properties_property ON public.loan_properties(property_id);
CREATE INDEX IF NOT EXISTS idx_loan_properties_organization ON public.loan_properties(organization_id);
CREATE INDEX IF NOT EXISTS idx_value_history_property ON public.value_history(property_id);
CREATE INDEX IF NOT EXISTS idx_value_history_organization ON public.value_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_first_charge_holders_organization ON public.first_charge_holders(organization_id);

-- Enable RLS
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.value_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_charge_holders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for properties (drop and recreate to ensure correct definitions)
DROP POLICY IF EXISTS "properties_select" ON public.properties;
DROP POLICY IF EXISTS "properties_insert" ON public.properties;
DROP POLICY IF EXISTS "properties_update" ON public.properties;
DROP POLICY IF EXISTS "properties_delete" ON public.properties;

CREATE POLICY "properties_select" ON public.properties
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "properties_insert" ON public.properties
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "properties_update" ON public.properties
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "properties_delete" ON public.properties
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

-- RLS Policies for loan_properties (drop and recreate)
DROP POLICY IF EXISTS "loan_properties_select" ON public.loan_properties;
DROP POLICY IF EXISTS "loan_properties_insert" ON public.loan_properties;
DROP POLICY IF EXISTS "loan_properties_update" ON public.loan_properties;
DROP POLICY IF EXISTS "loan_properties_delete" ON public.loan_properties;

CREATE POLICY "loan_properties_select" ON public.loan_properties
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "loan_properties_insert" ON public.loan_properties
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "loan_properties_update" ON public.loan_properties
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "loan_properties_delete" ON public.loan_properties
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

-- RLS Policies for value_history (drop and recreate)
DROP POLICY IF EXISTS "value_history_select" ON public.value_history;
DROP POLICY IF EXISTS "value_history_insert" ON public.value_history;
DROP POLICY IF EXISTS "value_history_update" ON public.value_history;
DROP POLICY IF EXISTS "value_history_delete" ON public.value_history;

CREATE POLICY "value_history_select" ON public.value_history
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "value_history_insert" ON public.value_history
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "value_history_update" ON public.value_history
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "value_history_delete" ON public.value_history
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

-- RLS Policies for first_charge_holders (drop and recreate)
DROP POLICY IF EXISTS "first_charge_holders_select" ON public.first_charge_holders;
DROP POLICY IF EXISTS "first_charge_holders_insert" ON public.first_charge_holders;
DROP POLICY IF EXISTS "first_charge_holders_update" ON public.first_charge_holders;
DROP POLICY IF EXISTS "first_charge_holders_delete" ON public.first_charge_holders;

CREATE POLICY "first_charge_holders_select" ON public.first_charge_holders
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "first_charge_holders_insert" ON public.first_charge_holders
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "first_charge_holders_update" ON public.first_charge_holders
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

CREATE POLICY "first_charge_holders_delete" ON public.first_charge_holders
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members
            WHERE user_id = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND is_super_admin = true)
    );

-- Comments
COMMENT ON TABLE public.properties IS 'Physical property assets used as loan collateral/security';
COMMENT ON TABLE public.loan_properties IS 'Links between loans and properties with charge type details';
COMMENT ON TABLE public.value_history IS 'Historical valuations and balance tracking for properties';
COMMENT ON TABLE public.first_charge_holders IS 'First charge lenders (for tracking second charge loans)';

COMMENT ON COLUMN public.loan_properties.charge_type IS 'Type of charge: First Charge or Second Charge';
COMMENT ON COLUMN public.loan_properties.first_charge_balance IS 'Outstanding balance on first charge (relevant for second charges)';
COMMENT ON COLUMN public.value_history.value_type IS 'Type of value: Property Valuation, First Charge Balance, Purchase Price, etc.';
