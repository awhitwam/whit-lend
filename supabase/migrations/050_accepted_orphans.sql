-- Accepted Orphans: Track entries that are intentionally not linked to bank statements
-- This allows users to mark transactions as "accepted orphans" with a reason

CREATE TABLE IF NOT EXISTS accepted_orphans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- The type of entity being marked as orphan
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'loan_transaction',
        'investor_transaction',
        'investor_interest',
        'expense',
        'other_income',
        'receipt'
    )),

    -- The ID of the entity (polymorphic reference)
    entity_id UUID NOT NULL,

    -- Reason for accepting as orphan
    reason TEXT NOT NULL,

    -- Who accepted it and when
    accepted_by UUID REFERENCES auth.users(id),
    accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint: one acceptance per entity
    UNIQUE(organization_id, entity_type, entity_id)
);

-- RLS policies
ALTER TABLE accepted_orphans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accepted_orphans_select" ON accepted_orphans
    FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "accepted_orphans_insert" ON accepted_orphans
    FOR INSERT WITH CHECK (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "accepted_orphans_update" ON accepted_orphans
    FOR UPDATE USING (organization_id IN (SELECT user_org_ids()));

CREATE POLICY "accepted_orphans_delete" ON accepted_orphans
    FOR DELETE USING (organization_id IN (SELECT user_org_ids()));

-- Index for fast lookups
CREATE INDEX idx_accepted_orphans_org_type ON accepted_orphans(organization_id, entity_type);
CREATE INDEX idx_accepted_orphans_entity ON accepted_orphans(entity_type, entity_id);
