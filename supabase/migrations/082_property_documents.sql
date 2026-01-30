-- Create property_documents table for storing document links and uploaded images
CREATE TABLE IF NOT EXISTS property_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Document info
  title VARCHAR(255) NOT NULL,
  document_type VARCHAR(50) NOT NULL,  -- 'photo', 'survey', 'title_deed', 'insurance', 'valuation', 'planning', 'other'
  notes TEXT,

  -- Storage (one of these will be set)
  external_url TEXT,           -- For Google Drive links, external URLs
  storage_path TEXT,           -- For uploaded images (Supabase Storage)

  -- Metadata
  mime_type VARCHAR(100),      -- 'image/jpeg', 'application/pdf', etc.
  file_size INTEGER,           -- Bytes (for uploads)

  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  CONSTRAINT valid_storage CHECK (external_url IS NOT NULL OR storage_path IS NOT NULL)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_property_documents_property ON property_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_property_documents_org ON property_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_property_documents_type ON property_documents(document_type);

-- Enable RLS
ALTER TABLE property_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view property documents in their organization"
ON property_documents FOR SELECT TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert property documents in their organization"
ON property_documents FOR INSERT TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can update property documents in their organization"
ON property_documents FOR UPDATE TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete property documents in their organization"
ON property_documents FOR DELETE TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid()
  )
);

-- Create storage bucket for property documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-documents',
  'property-documents',
  false,  -- Private bucket, requires auth
  10485760,  -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for property documents bucket
CREATE POLICY "Users can upload property documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'property-documents'
);

CREATE POLICY "Users can view property documents they have access to"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'property-documents'
);

CREATE POLICY "Users can delete property documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'property-documents'
);

CREATE POLICY "Users can update property documents"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'property-documents'
);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_property_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER property_documents_updated_at
  BEFORE UPDATE ON property_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_property_documents_updated_at();
