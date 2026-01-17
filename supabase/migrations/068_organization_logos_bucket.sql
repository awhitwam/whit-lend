-- Create storage bucket for organization logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-assets',
  'organization-assets',
  true,  -- Public bucket for logos
  2097152,  -- 2MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their organization's folder
CREATE POLICY "Users can upload organization logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'organization-assets'
  AND (storage.foldername(name))[1] = 'logos'
);

-- Allow public read access to all organization assets
CREATE POLICY "Public read access for organization assets"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'organization-assets');

-- Allow organization admins to delete their logos
CREATE POLICY "Organization admins can delete logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'organization-assets');

-- Allow organization admins to update (replace) their logos
CREATE POLICY "Organization admins can update logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'organization-assets');
