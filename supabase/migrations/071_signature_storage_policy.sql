-- Allow authenticated users to upload to the signatures folder
CREATE POLICY "Users can upload signatures"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'organization-assets'
  AND (storage.foldername(name))[1] = 'signatures'
);
